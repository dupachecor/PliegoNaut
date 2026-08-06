import os
import json
from datetime import datetime, timedelta
from pydantic import BaseModel, Field
from typing import List, Optional
from crewai import Agent, Task, Crew, Process
from llm_config import crear_llm


class PasoRuta(BaseModel):
    paso: int = Field(description="Número del paso")
    titulo: str = Field(description="Título del paso")
    descripcion: str = Field(description="Descripción detallada de qué hacer")
    fecha_limite: str = Field(description="Fecha límite o plazo estimado (ej: 'Día 1-3', '3 días antes del cierre')")
    documentos: List[str] = Field(description="Lista de documentos necesarios para este paso")
    estado: str = Field(default="pendiente", description="pendiente, en_proceso, completado")


class RutaPresentacion(BaseModel):
    resumen: str = Field(description="Resumen general del proceso")
    pasos: List[PasoRuta] = Field(description="Pasos ordenados para presentarse")
    plazo_total_dias: int = Field(description="Días totales estimados del proceso")
    fecha_cierre: Optional[str] = Field(default=None, description="Fecha de cierre del proceso si se conoce")
    advertencias: List[str] = Field(default=[], description="Advertencias importantes")


def generar_ruta_presentacion(pliego_texto: str, perfil_empresa: dict, secop_id: str, closing_date, entity_name: str) -> dict:
    """
    Usa CrewAI para generar una ruta de presentación paso a paso
    analizando el pliego de condiciones.
    """
    llm = crear_llm()

    agente_guia = Agent(
        role='Guía de Presentación de Licitaciones',
        goal='Generar una ruta paso a paso para que la empresa se presente exitosamente a esta licitación, con plazos, documentos y advertencias.',
        backstory='Eres un experto en contratación pública colombiana (Ley 80 de 1993, Ley 1150 de 2007). Conoces cada paso del proceso de presentación de ofertas en SECOP II. Eres metódico y detallista.',
        verbose=True,
        allow_delegation=False,
        llm=llm
    )

    closing_info = f"Fecha de cierre: {closing_date}" if closing_date else "Fecha de cierre no especificada en el pliego."

    tarea_ruta = Task(
        description=f'''
        Analiza el siguiente Pliego de Condiciones y genera una ruta de presentación paso a paso.

        PLIEGO (extracto):
        {pliego_texto[:3000]}

        DATOS DE LA EMPRESA:
        - Nombre: {perfil_empresa["nombre"]}
        - Certificaciones: {perfil_empresa["certificaciones"]}
        - UNSPSC: {perfil_empresa["codigos_unspsc"]}
        - Capital de trabajo: {perfil_empresa["capital_de_trabajo"]}

        DATOS DEL PROCESO:
        - SECOP ID: {secop_id}
        - Entidad: {entity_name}
        - {closing_info}

        Genera una ruta de presentación detallada que incluya:
        1. Cada paso necesario para presentarse (registro en SECOP, preparación de documentos, presentación de oferta, etc.)
        2. Documentos requeridos para cada paso
        3. Plazos estimados
        4. Advertencias críticas (requisitos habilitantes que podrían descartar a la empresa)
        5. Plazo total estimado del proceso
        ''',
        expected_output="Un JSON estructurado con la ruta de presentación completa, pasos ordenados, documentos y plazos.",
        agent=agente_guia,
        output_pydantic=RutaPresentacion
    )

    equipo = Crew(
        agents=[agente_guia],
        tasks=[tarea_ruta],
        process=Process.sequential,
        verbose=True
    )

    try:
        resultado = equipo.kickoff()
        if hasattr(resultado, 'pydantic') and resultado.pydantic:
            return resultado.pydantic.model_dump()
        elif isinstance(resultado, dict):
            return resultado
        else:
            return json.loads(str(resultado))
    except Exception as e:
        print(f"[!] Error generando ruta de presentación: {e}")
        return {
            "resumen": "No se pudo generar la ruta automáticamente. Revise el pliego manualmente.",
            "pasos": [
                {
                    "paso": 1,
                    "titulo": "Revisar pliego manualmente",
                    "descripcion": "La generación automática falló. Revise el pliego de condiciones directamente en SECOP II.",
                    "fecha_limite": "Antes del cierre",
                    "documentos": ["Pliego de condiciones"],
                    "estado": "pendiente"
                }
            ],
            "plazo_total_dias": 30,
            "advertencias": ["Generación automática falló. Se requiere revisión manual."]
        }
