import os
from crewai import LLM


def crear_llm(temperature: float = 0.3) -> LLM:
    """Crea el LLM según LLM_PROVIDER (gemini por defecto | ollama local).

    Se construye bajo demanda (no al importar el módulo) para que el worker
    siempre arranque: si la configuración está incompleta, el error aparece al
    procesar la tarea y se reporta como ERROR en la tarea, no como crash del
    proceso. Los agentes de análisis (agentes_pliego.py) y la generación de ruta
    (generador_ruta.py) comparten esta única implementación.
    """
    provider = os.getenv("LLM_PROVIDER", "gemini").lower().strip()

    if provider == "ollama":
        return LLM(
            model=f"ollama/{os.getenv('OLLAMA_MODEL', 'deepseek-r1:8b')}",
            base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            temperature=temperature,
        )

    if provider == "gemini":
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError(
                "LLM_PROVIDER=gemini requiere GEMINI_API_KEY. "
                "Configúrala en el .env o usa LLM_PROVIDER=ollama para LLM local."
            )
        return LLM(
            model=os.getenv("GEMINI_MODEL", "gemini/gemini-2.0-flash"),
            api_key=api_key,
            temperature=temperature,
        )

    raise ValueError(
        f"LLM_PROVIDER '{provider}' no soportado. Usa 'gemini' (default) u 'ollama'."
    )
