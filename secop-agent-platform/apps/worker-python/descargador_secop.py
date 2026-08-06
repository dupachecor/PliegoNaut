import os
import time
import signal
import sys
from urllib.parse import urlparse, parse_qs
from typing import Optional

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

_PLAYWRIGHT_INSTANCE = None
_BROWSER_INSTANCE = None

def _get_playwright():
    """Retorna la instancia persistente de Playwright (NO usar `with` para no cerrar los browsers)."""
    global _PLAYWRIGHT_INSTANCE
    if _PLAYWRIGHT_INSTANCE is None:
        _PLAYWRIGHT_INSTANCE = sync_playwright().start()
    return _PLAYWRIGHT_INSTANCE

class DescargadorSECOP:
    def __init__(self, download_dir: str = "./documentos/pdf_crudos", timeout: int = 60000, reuse_browser: bool = True):
        self.download_dir = os.path.abspath(download_dir)
        self.timeout = timeout
        self.reuse_browser = reuse_browser
        os.makedirs(self.download_dir, exist_ok=True)

    def _extraer_notice_uid(self, url: str) -> Optional[str]:
        try:
            parsed_url = urlparse(url)
            return parse_qs(parsed_url.query).get('noticeUID', [None])[0]
        except Exception:
            return None

    def _get_browser(self, playwright):
        global _BROWSER_INSTANCE
        if self.reuse_browser and _BROWSER_INSTANCE is not None:
            try:
                _BROWSER_INSTANCE.contexts
                return _BROWSER_INSTANCE
            except Exception:
                _BROWSER_INSTANCE = None
        browser = playwright.chromium.launch(headless=True)
        if self.reuse_browser:
            _BROWSER_INSTANCE = browser
        return browser

    def descargar_pliego(self, url_proceso: str) -> Optional[str]:
        if not PLAYWRIGHT_AVAILABLE:
            print("[!] Playwright no disponible")
            return None

        print(f"[*] Navegando: {url_proceso}")
        notice_uid = self._extraer_notice_uid(url_proceso)
        pdf_filename = f"pliego_{notice_uid}.pdf" if notice_uid else f"pliego_{int(time.time())}.pdf"
        pdf_path = os.path.join(self.download_dir, pdf_filename)

        if os.path.exists(pdf_path):
            print(f"[*] Ya existe: {pdf_filename}")
            return pdf_path

        browser = None
        try:
            p = _get_playwright()
            browser = self._get_browser(p)
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()
            page.set_default_timeout(self.timeout)

            page.goto(url_proceso, wait_until="domcontentloaded")
            print("[*] Buscando documentos...")

            selectores_seccion = [
                "text='Documentos'", "text=Documentos del Proceso",
                "a:has-text('Documentos')", "button:has-text('Documentos')",
                "text=Anexos", "text=Documentación",
            ]
            for sel in selectores_seccion:
                try:
                    page.wait_for_selector(sel, timeout=10000)
                    break
                except PWTimeoutError:
                    continue

            patrones_pliego = [
                "Pliego de Condiciones Definitivo", "Proyecto de Pliego",
                "Pliego de Condiciones", "Pliego Definitivo", "Pliego",
            ]
            pliego_element = None
            for patron in patrones_pliego:
                for tipo in [f"tr:has-text('{patron}')", f"a:has-text('{patron}')"]:
                    elemento = page.locator(tipo)
                    if elemento.count() > 0:
                        pliego_element = elemento
                        break
                if pliego_element:
                    break

            if pliego_element is None or pliego_element.count() == 0:
                print("[!] No se encontró el pliego")
                return None

            btn = pliego_element.locator(
                "a[title*='Descargar'], input[type='submit'][value*='Descargar'], "
                "a:has-text('Descargar'), button:has-text('Descargar'), "
                "a.download, button.download, a[href*='download'], a[href*='Descargar']"
            )
            if btn.count() == 0:
                btn = pliego_element.locator("a, button")

            if btn.count() > 0:
                with page.expect_download() as download_info:
                    btn.first.click()
                download = download_info.value
                download.save_as(pdf_path)
                print(f"[*] PDF guardado: {pdf_path}")
                return pdf_path
            else:
                print("[!] Sin botón de descarga")
                return None

        except Exception as e:
            print(f"[!] Error: {e}")
            return None
        finally:
            if browser and not self.reuse_browser:
                try:
                    browser.close()
                except Exception:
                    pass


def cleanup_browsers():
    global _BROWSER_INSTANCE, _PLAYWRIGHT_INSTANCE
    if _BROWSER_INSTANCE is not None:
        try:
            _BROWSER_INSTANCE.close()
        except Exception:
            pass
        _BROWSER_INSTANCE = None
    if _PLAYWRIGHT_INSTANCE is not None:
        try:
            _PLAYWRIGHT_INSTANCE.stop()
        except Exception:
            pass
        _PLAYWRIGHT_INSTANCE = None

signal.signal(signal.SIGTERM, lambda *_: cleanup_browsers())
signal.signal(signal.SIGINT, lambda *_: (cleanup_browsers(), sys.exit(0)))

if __name__ == "__main__":
    url_prueba = sys.argv[1] if len(sys.argv) > 1 else None
    if not url_prueba:
        print("Uso: python descargador_secop.py <url_del_proceso>")
        sys.exit(1)
    d = DescargadorSECOP()
    ruta = d.descargar_pliego(url_prueba)
    print(f"\n{'ÉXITO' if ruta else 'FALLO'}: {ruta or 'No se pudo descargar'}")
    cleanup_browsers()
