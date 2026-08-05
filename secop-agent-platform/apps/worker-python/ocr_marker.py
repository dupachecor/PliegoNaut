import os
import time
from pathlib import Path
from typing import Optional

# ==========================================
# AVISO SOBRE MARKER-PDF (Surya)
# ==========================================
# Marker utiliza modelos de Deep Learning (PyTorch) por debajo. 
# Automáticamente detectará tu RTX 4060 Ti (CUDA) gracias a que tienes 16GB de VRAM,
# lo que hará que el OCR y la detección de tablas sean sumamente rápidos.

# Intentar importar Marker-PDF (v0.x API) y fallback a pdfplumber si no está disponible
MARKER_AVAILABLE = False
MARKER_V2 = False
try:
    from marker.convert import convert_single_pdf
    from marker.models import load_all_models
    MARKER_AVAILABLE = True
except ImportError:
    try:
        from marker import convert_to_md
        MARKER_AVAILABLE = True
        MARKER_V2 = True
    except ImportError:
        print("[!] Librería 'marker-pdf' no encontrada. Se usará pdfplumber como fallback.")

PDFPLUMBER_AVAILABLE = False
try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    pass

class OCRExtractor:
    """Clase para manejar la extracción de texto estructurado de Pliegos de Condiciones"""

    def __init__(self, output_dir: str = "./documentos/markdown", use_gpu: bool = True):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.model_lst = None
        
        if MARKER_AVAILABLE and use_gpu:
            try:
                print("[*] Cargando modelos de Marker (GPU)...")
                self.model_lst = load_all_models()
                print("[*] Modelos cargados exitosamente.")
            except Exception as e:
                print(f"[!] No se pudieron cargar modelos Marker: {e}")
                self.model_lst = None

    def extraer_markdown_de_pdf(self, pdf_path: str, max_pages: Optional[int] = None) -> Optional[str]:
        """
        Toma un PDF (Pliego de Condiciones) y extrae su contenido a Markdown.
        Usa Marker-PDF si está disponible, cae a pdfplumber si no.
        """
        pdf_file = Path(pdf_path)
        if not pdf_file.exists():
            print(f"[!] Error: El archivo PDF {pdf_path} no existe.")
            return None

        md_filename = f"{pdf_file.stem}.md"
        output_file = self.output_dir / md_filename

        print(f"[*] Iniciando extracción para: {pdf_file.name}")
        start_time = time.time()

        try:
            full_text = None

            if MARKER_AVAILABLE and self.model_lst is not None:
                # Usar Marker-PDF con GPU
                full_text, _, _ = convert_single_pdf(
                    str(pdf_file),
                    self.model_lst,
                    max_pages=max_pages,
                    batch_multiplier=2
                )
            elif PDFPLUMBER_AVAILABLE:
                # Fallback a pdfplumber si Marker no está disponible
                print("[*] Usando pdfplumber como fallback (sin GPU)...")
                text_parts = []
                with pdfplumber.open(pdf_file) as pdf:
                    pages = pdf.pages[:max_pages] if max_pages else pdf.pages
                    for i, page in enumerate(pages):
                        text = page.extract_text()
                        if text:
                            text_parts.append(f"--- Página {i+1} ---\n{text}")
                        tables = page.extract_tables()
                        for j, table in enumerate(tables):
                            text_parts.append(f"\n[Tabla {j+1} - Página {i+1}]:\n")
                            for row in table:
                                text_parts.append(" | ".join(cell or "" for cell in row))
                full_text = "\n".join(text_parts)
            else:
                print("[!] No hay motor de OCR disponible (ni Marker ni pdfplumber).")
                return None

            if full_text:
                with open(output_file, "w", encoding="utf-8") as f:
                    f.write(full_text)
                end_time = time.time()
                print(f"[*] ✅ Extracción completada en {end_time - start_time:.2f} segundos.")
                print(f"[*] Markdown guardado en: {output_file}")
                return full_text
            else:
                print("[!] No se extrajo texto del PDF.")
                return None

        except Exception as e:
            print(f"[!] Error durante la extracción: {str(e)}")
            return None

if __name__ == "__main__":
    # Prueba del Pipeline
    extractor = OCRExtractor()
    
    # Crea un PDF de prueba vacío o coloca uno real en esta ruta para probar
    pdf_prueba = "pliego_prueba.pdf"
    
    if not os.path.exists(pdf_prueba):
        print(f"\n[INFO] Para probar el flujo, coloca un PDF del SECOP en la carpeta raíz y llámalo '{pdf_prueba}'.")
    else:
        # Extraemos solo las primeras 5 páginas para probar que no se rompa la memoria RAM
        resultado = extractor.extraer_markdown_de_pdf(pdf_prueba, max_pages=5)
        if resultado:
            print("\n" + "="*50)
            print("VISTA PREVIA DEL MARKDOWN (Fase C lista para consumir):")
            print("="*50)
            print(resultado[:500] + "...\n[Continúa...]")
