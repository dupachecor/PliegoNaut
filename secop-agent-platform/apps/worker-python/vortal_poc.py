#!/usr/bin/env python3
# ===== PoC de viabilidad (Python): scraping de VORTAL con undetected-chromedriver =====
# Fase 2.0 del PLAN_TIEMPO_REAL.md — opción GRATUITA #3.
#
# Objetivo: validar si undetected-chromedriver (Chrome "limpio" + anti-detección)
# puede pasar el intersticial de reCAPTCHA v2 de community.secop.gov.co y extraer
# la lista de avisos sin ser baneado.
#
# Uso:
#   .venv/bin/python vortal_poc.py --attempts 3
#   .venv/bin/python vortal_poc.py --attempts 1 --headful --chrome /ruta/chrome
#
# Flags:
#   --attempts N    número de intentos (default 3)
#   --headful       navegador visible (default: headless)
#   --url <url>     URL a probar (default: lista pública de avisos)
#   --out <dir>     directorio de resultados (default storage/poc)
#   --chrome <path> binario de Chromium (default: detecta el de Playwright)

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

# ===== Shim de distutils (eliminado en Python 3.12) =====
# undetected-chromedriver 3.5.5 importa `distutils.version.LooseVersion` al cargar.
# Se inyecta un shim mínimo ANTES de importar el módulo.
if sys.version_info >= (3, 12):
    import types

    _distutils = types.ModuleType("distutils")
    _version_mod = types.ModuleType("distutils.version")

    class LooseVersion:
        def __init__(self, vstring: str):
            self.vstring = str(vstring)
            parts = re.split(r"[^\d.]+", self.vstring)
            nums = [p for p in parts if p]
            self.version = list(map(int, nums[0].split("."))) if nums else []

        def __lt__(self, other):
            return self.version < other.version

        def __le__(self, other):
            return self.version <= other.version

        def __gt__(self, other):
            return self.version > other.version

        def __ge__(self, other):
            return self.version >= other.version

        def __eq__(self, other):
            return self.version == other.version

        def __str__(self):
            return ".".join(map(str, self.version))

    _version_mod.LooseVersion = LooseVersion
    _distutils.version = _version_mod
    sys.modules["distutils"] = _distutils
    sys.modules["distutils.version"] = _version_mod

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By

VORTAL_BASE_URL = os.getenv("VORTAL_BASE_URL", "https://community.secop.gov.co")
NOTICES_URL = (
    f"{VORTAL_BASE_URL}/Public/Tendering/ContractNoticeManagement/Index"
    "?isLV=0&RecordsPerPage=10"
    "&customValues=0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0"
)

LOG = lambda *a: print("[POC-PY]", *a)  # noqa: E731


def resolve_chrome_path(explicit: str | None) -> str:
    if explicit and os.path.exists(explicit):
        return explicit
    for env in ("CHROME_PATH",):
        if os.environ.get(env) and os.path.exists(os.environ[env]):
            return os.environ[env]
    # caché de Playwright: ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome
    home = Path.home() / ".cache" / "ms-playwright"
    if home.exists():
        chromiums = sorted([d for d in home.iterdir() if d.name.startswith("chromium")])
        for d in reversed(chromiums):
            for sub in d.iterdir():
                bin_path = sub / "chrome"
                if bin_path.exists():
                    return str(bin_path)
    raise SystemExit(
        "No se encontró Chromium. Usa --chrome <path> o instala Playwright "
        "(python -m playwright install chromium)."
    )


def chrome_version(bin_path: str) -> int:
    """Extrae el major de Chrome desde el binario (--version)."""
    import subprocess

    try:
        out = subprocess.run([bin_path, "--version"], capture_output=True, text=True, timeout=15)
        m = re.search(r"(\d+)\.\d+\.\d+", out.stdout or "")
        if m:
            return int(m.group(1))
    except Exception:
        pass
    raise SystemExit(f"No se pudo detectar la versión de Chrome en {bin_path}")


def looks_blocked(text: str) -> bool:
    return bool(re.search(r"403|forbidden|access denied", text, re.IGNORECASE))


def detect_captcha(driver) -> dict:
    """Devuelve info del reCAPTCHA v2 si está presente (checkbox anchor iframe)."""
    frames = driver.find_elements(By.TAG_NAME, "iframe")
    info = {"present": False, "anchor": False, "challenge": False, "srcs": []}
    for f in frames:
        src = (f.get_attribute("src") or "")[:120]
        info["srcs"].append(src)
        if "recaptcha/api2/anchor" in src:
            info["anchor"] = True
            info["present"] = True
        if "recaptcha/api2/bframe" in src:
            info["challenge"] = True
    return info


def click_recaptcha_checkbox(driver) -> bool:
    """Hace click en el checkbox de reCAPTCHA v2 dentro del iframe anchor."""
    frames = driver.find_elements(By.TAG_NAME, "iframe")
    for f in frames:
        src = f.get_attribute("src") or ""
        if "recaptcha/api2/anchor" in src:
            try:
                driver.switch_to.frame(f)
                time.sleep(1)
                checkbox = driver.find_element(By.CSS_SELECTOR, ".recaptcha-checkbox-border")
                checkbox.click()
                time.sleep(2)
                driver.switch_to.default_content()
                return True
            except Exception as e:
                LOG(f"click checkbox falló: {e}")
                driver.switch_to.default_content()
                return False
    return False


def extract_notices(driver) -> tuple[list[str], str]:
    uids: list[str] = []
    first_row = ""
    try:
        links = driver.find_elements(By.CSS_SELECTOR, "a[href*='noticeUID']")
        for a in links:
            href = a.get_attribute("href") or ""
            m = re.search(r"noticeUID=([0-9A-Za-z-]+)", href, re.IGNORECASE)
            if m and m.group(1) not in uids:
                uids.append(m.group(1))
    except Exception:
        pass
    try:
        rows = driver.find_elements(By.CSS_SELECTOR, "table tbody tr")
        if rows:
            first_row = (rows[0].text or "")[:400]
    except Exception:
        pass
    return uids, first_row


def run_attempt(driver, url: str, attempt: int) -> dict:
    started = time.time()
    result = {
        "attempt": attempt,
        "ok": False,
        "blocked": False,
        "captchaDetected": False,
        "captchaClickTried": False,
        "noticesFound": 0,
        "noticeUids": [],
        "firstRowText": "",
        "title": "",
        "durationMs": 0,
        "error": None,
    }
    try:
        LOG(f"[intento {attempt}] Navegando a {url}")
        driver.get(url)
        time.sleep(4)

        result["title"] = driver.title or ""

        captcha = detect_captcha(driver)
        result["captchaDetected"] = captcha["present"]
        LOG(f"[intento {attempt}] captcha={captcha['present']} title='{result['title']}' "
            f"anchor={captcha['anchor']} challenge={captcha['challenge']}")

        if captcha["present"]:
            result["captchaClickTried"] = True
            LOG(f"[intento {attempt}] Clickeando checkbox reCAPTCHA v2...")
            clicked = click_recaptcha_checkbox(driver)
            if clicked:
                # esperar a que Google procese y la app reemplace el intersticial
                for _ in range(12):
                    time.sleep(2.5)
                    body = (driver.page_source or "").lower()
                    if "recaptcha/api2/anchor" not in body:
                        break
                time.sleep(3)

        captcha_after = detect_captcha(driver)
        body_text = ""
        try:
            body_text = driver.find_element(By.TAG_NAME, "body").text or ""
        except Exception:
            pass

        result["blocked"] = looks_blocked(body_text)
        result["captchaDetected"] = result["captchaDetected"] or captcha_after["present"]

        uids, first_row = extract_notices(driver)
        result["noticeUids"] = uids
        result["firstRowText"] = first_row
        result["noticesFound"] = len(uids)
        result["ok"] = (not result["blocked"]) and len(uids) > 0
        result["durationMs"] = int((time.time() - started) * 1000)

        LOG(f"[intento {attempt}] blocked={result['blocked']} avisos={len(uids)} "
            f"captcha_final={captcha_after['present']} duración={(result['durationMs']/1000):.1f}s")
        if uids:
            LOG(f"[intento {attempt}] primer noticeUID: {uids[0]}")
        if first_row:
            LOG(f"[intento {attempt}] primera fila: {first_row[:120]}...")
    except Exception as e:
        result["error"] = str(e)
        result["durationMs"] = int((time.time() - started) * 1000)
        LOG(f"[intento {attempt}] ERROR: {e}")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--headful", action="store_true")
    parser.add_argument("--url", default=NOTICES_URL)
    parser.add_argument("--out", default=str(Path("storage/poc").resolve()))
    parser.add_argument("--chrome")
    args = parser.parse_args()

    chrome_bin = resolve_chrome_path(args.chrome)
    version_main = chrome_version(chrome_bin)
    LOG(f"Chromium: {chrome_bin}")
    LOG(f"Versión Chrome: {version_main}")
    LOG(f"Intentos: {args.attempts} | headful: {args.headful}")
    LOG(f"Resultados: {args.out}")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    user_data = out_dir / "user_data_py"

    results = []
    try:
        driver = uc.Chrome(
            version_main=version_main,
            browser_executable_path=chrome_bin,
            user_data_dir=str(user_data),
            headless=not args.headful,
        )
        for i in range(1, args.attempts + 1):
            results.append(run_attempt(driver, args.url, i))
            if i < args.attempts:
                delay = 30 + (i * 5)
                LOG(f"Esperando {delay}s antes del siguiente intento...")
                time.sleep(delay)
    except Exception as e:
        LOG(f"FATAL lanzando driver: {e}")
        sys.exit(1)
    finally:
        try:
            driver.quit()
        except Exception:
            pass

    success = sum(1 for r in results if r["ok"])
    rate = (success / len(results)) * 100 if results else 0
    summary = {
        "fecha": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "url": args.url,
        "motor": "undetected-chromedriver",
        "chrome": chrome_bin,
        "intentos": len(results),
        "exito": success,
        "exitoRate": rate,
        "bloqueado": sum(1 for r in results if r["blocked"]),
        "captchaVisto": sum(1 for r in results if r["captchaDetected"]),
        "intentosDetalle": results,
    }
    out_file = out_dir / f"vortal-poc-py-{int(time.time()*1000)}.json"
    out_file.write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    LOG(f"Resultados guardados en {out_file}")

    print("\n===== RESUMEN PoC VORTAL (Python) =====")
    print(f"  Éxito: {success}/{len(results)} ({rate:.0f}%)")
    print(f"  Bloqueado: {summary['bloqueado']} | Captcha visto: {summary['captchaVisto']}")
    print(f"  Criterio GO (>=80%): {'GO ✅' if rate >= 80 else 'NO-GO ❌'}")
    print("=======================================\n")


if __name__ == "__main__":
    main()
