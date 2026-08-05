import os
import time
import signal
import sys
import json
import requests
import websocket
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from dotenv import load_dotenv
load_dotenv()
from descargador_secop import DescargadorSECOP, cleanup_browsers
from ocr_marker import OCRExtractor
from agentes_pliego import crear_equipo_analisis, VeredictoFinal, ReporteLegal, ReporteFinanciero
from generador_ruta import generar_ruta_presentacion

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3001")
WORKER_API_KEY = os.getenv("WORKER_API_KEY", "worker-dev-key-change")
MAX_OCR_PAGES = int(os.getenv("MAX_OCR_PAGES", "50")) or None
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "60"))
_running = True

def _auth_headers():
    return {"Authorization": f"Bearer {WORKER_API_KEY}"}


def _ws_url():
    return BACKEND_URL.replace("http://", "ws://").replace("https://", "wss://")


def escuchar_websocket():
    """Escucha eventos WebSocket del backend para saber cuando hay tareas nuevas."""
    global _running
    ws = None
    while _running:
        try:
            url = f"{_ws_url()}/api/worker/stream?token={WORKER_API_KEY}"
            ws = websocket.WebSocket()
            ws.settimeout(120)
            ws.connect(url, header=[f"Authorization: Bearer {WORKER_API_KEY}"])
            print("[WS] Conectado al backend")
            ws.settimeout(300)
            while _running:
                msg = ws.recv()
                if msg:
                    pass
        except (websocket.WebSocketException, ConnectionError, OSError) as e:
            if _running:
                print(f"[WS] Desconectado (fallback a polling): {e}")
        except Exception:
            pass
        finally:
            if ws:
                try:
                    ws.close()
                except Exception:
                    pass
        if _running:
            time.sleep(5)


def obtener_tareas_pendientes():
    try:
        response = requests.get(
            f"{BACKEND_URL}/api/worker/tasks",
            headers=_auth_headers(),
            timeout=15,
        )
        if response.status_code == 200:
            return response.json()
        print(f"[!] Backend respondió {response.status_code}: {response.text[:200]}")
        return []
    except requests.exceptions.RequestException as e:
        print(f"[!] Error conectando al backend: {e}")
        return []


def validar_veredicto(v: VeredictoFinal) -> bool:
    if not isinstance(v.viable, bool):
        return False
    if not isinstance(v.score_viabilidad, int) or v.score_viabilidad < 0 or v.score_viabilidad > 100:
        return False
    if not v.resumen_ejecutivo or len(v.resumen_ejecutivo) < 10:
        return False
    if v.viable and v.causales_rechazo:
        return False
    if not v.viable and not v.causales_rechazo:
        return False
    return True


def enviar_resultado(task_id: str, resultado_crew, reporte_legal=None, reporte_financiero=None, ruta_presentacion=None, error_msg=None):
    try:
        if isinstance(resultado_crew, str):
            data = json.loads(resultado_crew)
            v = VeredictoFinal(**data)
        elif hasattr(resultado_crew, "pydantic") and resultado_crew.pydantic:
            v = resultado_crew.pydantic
        elif isinstance(resultado_crew, VeredictoFinal):
            v = resultado_crew
        elif isinstance(resultado_crew, dict):
            v = VeredictoFinal(**resultado_crew)
        else:
            print(f"[!] Formato de veredicto no reconocido: {type(resultado_crew)}")
            return False
    except Exception as e:
        print(f"[!] Error parseando veredicto: {e}")
        return False

    if not validar_veredicto(v):
        print(f"[!] Veredicto inválido, rechazando")
        return False

    reporte_final = f"**Resumen Ejecutivo:**\n{v.resumen_ejecutivo}\n\n"
    if v.causales_rechazo:
        reporte_final += "**Causales de Rechazo:**\n- " + "\n- ".join(v.causales_rechazo)

    payload = {
        "status": "VIABLE" if v.viable else "REJECTED",
        "viabilityScore": v.score_viabilidad,
        "reportLegal": json.dumps(reporte_legal, ensure_ascii=False) if reporte_legal else None,
        "reportFinancial": json.dumps(reporte_financiero, ensure_ascii=False) if reporte_financiero else None,
        "reportFinal": reporte_final,
        "presentationRoute": json.dumps(ruta_presentacion, ensure_ascii=False) if ruta_presentacion else None,
    }

    if error_msg:
        payload["status"] = "ERROR"
        payload["errorMessage"] = error_msg

    try:
        response = requests.patch(
            f"{BACKEND_URL}/api/worker/tasks/{task_id}/analysis",
            json=payload,
            headers=_auth_headers(),
            timeout=15,
        )
        if response.status_code == 200:
            print(f"[*] Resultado enviado para tarea {task_id}: {v.viable} (score={v.score_viabilidad})")
            return True
        print(f"[!] Backend rechazó resultado: {response.status_code} {response.text[:200]}")
        return False
    except requests.exceptions.RequestException as e:
        print(f"[!] Error enviando resultado: {e}")
        return False


def procesar_tarea(task: dict):
    print(f"\n{'='*50}")
    print(f"[WORKER] Procesando: {task.get('secopId', 'N/A')} - {task.get('entity', 'N/A')}")
    print(f"   Empresa: {task.get('company', {}).get('name', 'N/A')}")
    print(f"{'='*50}")

    company = task.get('company', {})
    if not company:
        print("[!] Tarea sin datos de empresa, saltando")
        return

    # FASE B1: Descarga
    print("[FASE B1] Descargando PDF...")
    descargador = DescargadorSECOP()
    pdf_path = descargador.descargar_pliego(task.get('urlPliego', ''))

    # FASE B2: OCR
    texto_pliego = None
    if pdf_path and os.path.exists(pdf_path):
        print("[FASE B2] Extrayendo texto...")
        extractor = OCRExtractor()
        texto_pliego = extractor.extraer_markdown_de_pdf(pdf_path, max_pages=MAX_OCR_PAGES)

    if not texto_pliego:
        print("[!] No se pudo extraer texto del PDF. Abortando análisis.")
        enviar_resultado(
            task['id'],
            VeredictoFinal(
                viable=False,
                score_viabilidad=0,
                resumen_ejecutivo="No se pudo descargar o procesar el pliego de condiciones.",
                causales_rechazo=["No se pudo obtener el documento para análisis."],
            ),
            error_msg="PDF no descargado o texto no extraído"
        )
        return

    # FASE C: Análisis IA
    print("[FASE C] Analizando con CrewAI...")
    try:
        certificaciones = company.get('certifications', '[]')
        if isinstance(certificaciones, str):
            try:
                cert_list = json.loads(certificaciones)
            except json.JSONDecodeError:
                cert_list = []
        else:
            cert_list = certificaciones

        unspsc_raw = company.get('unspscCodes', '')
        unspsc_list = [c.strip() for c in unspsc_raw.split(',') if c.strip()] if unspsc_raw else []

        perfil_empresa = {
            "nombre": company.get('name', 'Empresa'),
            "certificaciones": cert_list,
            "codigos_unspsc": unspsc_list,
            "liquidez": company.get('liquidity', 0),
            "capital_de_trabajo": company.get('workingCapital', 0),
        }

        equipo = crear_equipo_analisis(texto_pliego, perfil_empresa)
        resultado = equipo.kickoff()

        # Extraer reportes intermedios de las tareas
        reporte_legal = None
        reporte_financiero = None
        for task_output in resultado.tasks_output:
            if hasattr(task_output, 'pydantic') and task_output.pydantic:
                if isinstance(task_output.pydantic, ReporteLegal):
                    reporte_legal = task_output.pydantic.model_dump()
                elif isinstance(task_output.pydantic, ReporteFinanciero):
                    reporte_financiero = task_output.pydantic.model_dump()

        # Generar ruta de presentación si es viable
        ruta_presentacion = None
        if resultado.pydantic and resultado.pydantic.viable:
            ruta_presentacion = generar_ruta_presentacion(
                texto_pliego, perfil_empresa, task.get('secopId', ''),
                task.get('closingDate'), task.get('entity', '')
            )

        enviar_resultado(task['id'], resultado, reporte_legal, reporte_financiero, ruta_presentacion)

    except Exception as e:
        print(f"[!] Error en análisis IA: {e}")
        import traceback
        traceback.print_exc()
        enviar_resultado(
            task['id'],
            VeredictoFinal(
                viable=False,
                score_viabilidad=0,
                resumen_ejecutivo=f"Error durante el análisis automático: {str(e)}",
                causales_rechazo=["Error en el pipeline de IA."],
            ),
            error_msg=str(e)
        )


def run_worker_loop():
    global _running
    print(f"\n{'*'*60}")
    print(f"WORKER IA - Conectado a {BACKEND_URL}")
    print(f"Poll cada {POLL_INTERVAL}s | OCR máx {MAX_OCR_PAGES or 'ilimitado'} páginas")
    print(f"{'*'*60}\n")

    ws_thread = threading.Thread(target=escuchar_websocket, daemon=True)
    ws_thread.start()

    poll_interval = 5
    while _running:
        tareas = obtener_tareas_pendientes()
        if tareas and len(tareas) > 0:
            print(f"[*] {len(tareas)} tarea(s) pendiente(s)")
            for task in tareas:
                if not _running:
                    break
                procesar_tarea(task)
            poll_interval = 5
        else:
            sys.stdout.write(f"\r[INFO] Sin tareas. Siguiente poll en {poll_interval}s...")
            sys.stdout.flush()
            poll_interval = POLL_INTERVAL

        for _ in range(poll_interval):
            if not _running:
                break
            time.sleep(1)


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "ok", "service": "worker"}).encode())

    def log_message(self, format, *args):
        pass


def run_health_server():
    port = int(os.getenv("WORKER_HEALTH_PORT", "0"))
    for intento in range(5):
        try:
            httpd = HTTPServer(("0.0.0.0", port or 0), HealthHandler)
            actual_port = httpd.server_address[1]
            print(f"[WORKER] Health server en puerto {actual_port}")
            os.environ["WORKER_HEALTH_PORT"] = str(actual_port)
            httpd.serve_forever()
            return
        except OSError as e:
            if "Address already in use" in str(e) and intento < 4:
                print(f"[WORKER] Puerto {port or 'aleatorio'} ocupado, reintentando...")
                time.sleep(1)
            else:
                print(f"[WORKER] Health server no disponible: {e}")
                return


def handle_shutdown(signum, frame):
    global _running
    print(f"\n[*] Señal {signum} recibida. Deteniendo worker...")
    _running = False
    cleanup_browsers()
    sys.exit(0)


signal.signal(signal.SIGTERM, handle_shutdown)
signal.signal(signal.SIGINT, handle_shutdown)

if __name__ == "__main__":
    health_thread = threading.Thread(target=run_health_server, daemon=True)
    health_thread.start()
    run_worker_loop()
