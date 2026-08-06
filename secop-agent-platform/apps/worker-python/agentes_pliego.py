import os
from typing import List, Optional
from pydantic import BaseModel, Field
from crewai import Agent, Task, Crew, Process
from llm_config import crear_llm

# ==========================================
# 1. MODELOS DE VALIDACIÓN Y SALIDA (AI HARNESS - PYDANTIC)
# ==========================================
# Esto asegura que los agentes devuelvan datos estructurados y SIEMPRE citen la página
class Hallazgo(BaseModel):
    descripcion: str = Field(description="Descripción detallada del requisito o bloqueo encontrado")
    pagina_citada: str = Field(description="Página o sección exacta del pliego donde se encontró (ej: 'Página 14', 'Sección 3.2')")
    cumple: bool = Field(description="¿La empresa cumple con este requisito?")

class ReporteLegal(BaseModel):
    riesgos_habilitantes: List[Hallazgo] = Field(description="Lista de requisitos legales habilitantes, pólizas y experiencia exigida")
    es_viable_legalmente: bool = Field(description="True si la empresa cumple todo lo legal, False si hay un bloqueo insalvable")

class ReporteFinanciero(BaseModel):
    analisis_indicadores: List[Hallazgo] = Field(description="Análisis de liquidez, capital de trabajo y presupuesto vs los requeridos")
    anticipos_y_pagos: str = Field(description="Resumen de la forma de pago (Ej: Anticipo del 30%)")
    es_viable_financieramente: bool = Field(description="True si la empresa cumple los ratios financieros exigidos")

class VeredictoFinal(BaseModel):
    viable: bool = Field(description="Veredicto final: ¿Debería la empresa presentarse a esta licitación?")
    score_viabilidad: int = Field(ge=0, le=100, description="Puntuación de 0 a 100 sobre qué tan perfecto es el match")
    resumen_ejecutivo: str = Field(description="Resumen para la gerencia justificando la decisión")
    causales_rechazo: List[str] = Field(description="Si viable es False, listar las razones exactas. Vacío si es viable.")

# ==========================================
# 2. CONFIGURACIÓN DEL LLM
# ==========================================
# Provider actual: Gemini API (LLM_PROVIDER=gemini, default). Requiere GEMINI_API_KEY.
# Alternativa local: Ollama (LLM_PROVIDER=ollama, modelo deepseek-r1:8b).
# El LLM se construye bajo demanda en crear_equipo_analisis() (ver llm_config.py):
# así el worker arranca aunque la clave no esté configurada, y el error aparece
# solo al procesar la tarea (se reporta como ERROR en la tarea).

# ==========================================
# 3. DEFINICIÓN DE LOS AGENTES
# ==========================================
def crear_equipo_analisis(pliego_markdown: str, perfil_empresa: dict) -> Crew:
    llm = crear_llm()
    # AGENTE 1: Analista Legal
    analista_legal = Agent(
        role='Analista Jurídico de Licitaciones Públicas',
        goal='Revisar el pliego de condiciones, identificar causales de rechazo, experiencia habilitante y pólizas, y compararlo con el perfil de la empresa.',
        backstory='Eres un abogado experto en contratación estatal en Colombia (Ley 80). Eres implacable buscando "trampas" o requisitos habilitantes que la empresa no cumple. SIEMPRE debes citar la página donde encuentras cada requisito.',
        verbose=True,
        allow_delegation=False,
        llm=llm
    )

    # AGENTE 2: Analista Financiero
    analista_financiero = Agent(
        role='Analista Financiero de Licitaciones',
        goal='Evaluar el presupuesto oficial, formas de pago (anticipos) y calcular si la empresa cumple con la liquidez, endeudamiento y capital de trabajo exigidos.',
        backstory='Eres un auditor financiero calculador. Revisas al milímetro si la empresa tiene la capacidad económica para soportar la ejecución del contrato sin quebrar.',
        verbose=True,
        allow_delegation=False,
        llm=llm
    )

    # AGENTE 3: Juez Final
    juez_final = Agent(
        role='Comité Estructurador y Juez',
        goal='Emitir el veredicto final cruzando los reportes legales y financieros. Determinar si se aprueba o rechaza la participación.',
        backstory='Eres el Director de Licitaciones. Tu tiempo es oro. Tomas decisiones binarias basadas en los reportes de tu equipo. Asignas un Score de 0 a 100.',
        verbose=True,
        allow_delegation=False,
        llm=llm
    )

    # ==========================================
    # 4. DEFINICIÓN DE LAS TAREAS (TASKS)
    # ==========================================
    tarea_legal = Task(
        description=f'''
        Analiza el siguiente Pliego de Condiciones (en formato Markdown):
        {pliego_markdown}

        Perfil de nuestra Empresa:
        - Nombre: {perfil_empresa["nombre"]}
        - Certificaciones: {perfil_empresa["certificaciones"]}
        - Experiencia (UNSPSC): {perfil_empresa["codigos_unspsc"]}

        Busca requisitos habilitantes, pólizas y experiencia requerida.
        ¿Cumplimos? Extrae hallazgos y cita la página exacta.
        ''',
        expected_output="Un reporte detallado de los requisitos legales y si la empresa cumple. Debe extraer una lista de hallazgos con página citada y un bool de viabilidad.",
        agent=analista_legal,
        output_pydantic=ReporteLegal # Fuerza al LLM a devolver esta estructura
    )

    tarea_financiera = Task(
        description=f'''
        Analiza el mismo Pliego de Condiciones.

        Perfil Financiero de nuestra Empresa:
        - Liquidez: {perfil_empresa["liquidez"]}
        - Capital de Trabajo: {perfil_empresa["capital_de_trabajo"]}

        Busca la sección financiera del pliego. Identifica los indicadores exigidos (índice de liquidez, capital de trabajo, etc.) y la forma de pago (si hay anticipo).
        ¿Cumplimos financieramente? Cita la página exacta de los requisitos.
        ''',
        expected_output="Un reporte financiero evaluando indicadores, forma de pago y si la empresa cumple financieramente.",
        agent=analista_financiero,
        output_pydantic=ReporteFinanciero
    )

    tarea_juez = Task(
        description='''
        Basado en el Reporte Legal y el Reporte Financiero generados por tu equipo, toma la decisión final.
        Si hay un solo requisito habilitante legal o financiero que no se cumple, el veredicto DEBE ser viable = False y el score menor a 50.
        Si se cumple todo, viable = True, asigna un score alto y genera un resumen ejecutivo.
        ''',
        expected_output="Un JSON estructurado con el veredicto final, score, resumen y riesgos.",
        agent=juez_final,
        output_pydantic=VeredictoFinal # El resultado de la Crew será este modelo JSON estricto
    )

    # ==========================================
    # 5. CREACIÓN DE LA CREW
    # ==========================================
    equipo = Crew(
        agents=[analista_legal, analista_financiero, juez_final],
        tasks=[tarea_legal, tarea_financiera, tarea_juez],
        process=Process.sequential, # Tarea 1 -> Tarea 2 -> Tarea 3
        verbose=True
    )

    return equipo

if __name__ == "__main__":
    # ==========================================
    # PRUEBA DEL FLUJO (DRY RUN)
    # ==========================================
    print("[*] Iniciando Fase C: Entorno Agéntico (CrewAI)")
    
    # Mock de un Perfil de Empresa sacado de la Base de Datos (Fase 2)
    empresa_mock = {
        "nombre": "TechNaut SAS",
        "certificaciones": ["ISO 9001"],
        "codigos_unspsc": ["81111800", "43211500"],
        "liquidez": 1.5,
        "capital_de_trabajo": 150000000.0
    }

    # Mock de un Pliego convertido a Markdown por Marker (Fase B)
    pliego_mock = """
    # PLIEGO DE CONDICIONES - SECOP II
    ## SECCIÓN 1. OBJETO
    El objeto es la prestación de servicios tecnológicos.
    
    ## SECCIÓN 2. REQUISITOS HABILITANTES (Página 12)
    El proponente debe contar con certificación ISO 9001 vigente.
    Debe tener experiencia en el código UNSPSC 81111800.
    
    ## SECCIÓN 3. REQUISITOS FINANCIEROS (Página 24)
    Índice de liquidez mayor o igual a 1.2.
    Capital de trabajo mayor o igual a $100.000.000 COP.
    Forma de pago: No se otorgarán anticipos. Pagos mensuales contra entrega.
    """

    equipo_pliegonaut = crear_equipo_analisis(pliego_mock, empresa_mock)
    
    print("[*] Ejecutando Agentes... (Requiere GEMINI_API_KEY configurada o Ollama activo para procesar el veredicto)")
    
    try:
        # En producción esto demora entre 10 a 30 segundos
        resultado_final = equipo_pliegonaut.kickoff()
        
        print("\n" + "="*50)
        print("VEREDICTO FINAL DEL JUEZ (JSON ESTRUCTURADO)")
        print("="*50)
        
        # CrewAI en su última versión devuelve el objeto Pydantic directamente gracias al output_pydantic
        if hasattr(resultado_final, "pydantic"):
            print(resultado_final.pydantic.model_dump_json(indent=4))
        else:
            print(resultado_final)
            
    except Exception as e:
        print(f"\n[!] Error en la ejecución de CrewAI: {str(e)}")
        print("\n[INFO] Para que esto corra exitosamente, asegúrate de instalar las dependencias:")
        print("       pip install 'crewai[google-genai]' pydantic")
        print("       Y exportar tu GEMINI_API_KEY (provider default) o activar Ollama.")