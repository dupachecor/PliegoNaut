# SCRAPER_RISK.md — Decisión documentada sobre scraping de VORTAL

**Fecha:** 2026-08-06
**Autor:** Equipo PliegoNaut
**Propósito:** Documentar la decisión de implementar un scraper sobre `community.secop.gov.co` (VORTAL), con análisis legal, mitigaciones técnicas y aceptación de riesgo por parte del usuario.

---

## 1. Contexto

PliegoNaut detecta en tiempo real procesos de contratación pública colombiana. La fuente oficial pública (`datos.gov.co`, Socrata) se actualiza **una vez al día** (ETL de Colombia Compra Eficiente), con un retraso inherente de ~24h. La plataforma transaccional `community.secop.gov.co` (VORTAL) es **tiempo real** pero **no expone API pública**: solo HTML+JS con un intersticial de ReCaptcha para acceso anónimo.

Para reducir el lag de detección de ~24h a minutos, PliegoNaut navega la **zona pública** de VORTAL (sin autenticación), extrae la lista de avisos publicados y descarga los documentos (pliegos, addendos, avisos) que las entidades públicas suben al portal.

---

## 2. Análisis legal

### 2.1 Ley 1712 de 2012 (Transparencia y Acceso a la Información Pública)

- La información de contratación pública es **información pública** por mandato legal. El principio de **divulgación proactiva** (arts. 9-10) obliga a las entidades a publicar proactivamente los procesos de contratación.
- La Ley 1712 fomenta el **uso y reutilización de la información pública** (art. 20): *"…se garantizará el acceso a la información pública… y su utilización… con fines de lucro o no"*. El reuso es un objetivo expreso de la política de datos abiertos de Colombia (CONPES 3920/2018).
- **Conclusión:** el scraping de datos públicos de contratación **se enmarca en el reuso de información pública** amparado por la Ley 1712 y la política de datos abiertos. Este es el argumento jurídico más fuerte a favor.

### 2.2 Términos de uso de VORTAL

- Los términos de uso de la plataforma VORTAL **podrían restringir el scraping automatizado**, aunque no se ha accedido al texto vigente durante la elaboración de este documento (el sitio exige navegación interactiva y no expone los términos en la zona pública sin resolver el ReCaptcha).
- **Riesgo:** si los términos prohíben expresamente la extracción automatizada, el scraping podría constituir un incumplimiento contractual. Esto es un riesgo de naturaleza **contractual/civil**, no penal.
- **Mitigación:** se documenta este riesgo y se adopta un volumen conservador (ver §3). Si se obtiene el texto de los términos, debe revisarse y actualizar este documento.

### 2.3 Propiedad intelectual / derechos de autor

- Los documentos (pliegos, estudios previos, avisos) son elaborados por **entidades públicas** en ejercicio de funciones públicas. No están protegidos por derechos de autor en el sentido tradicional (obras oficiales), y su divulgación es obligatoria por Ley 1712.
- **Conclusión:** el almacenamiento y procesamiento interno (análisis con IA) no infringe derechos patrimoniales de autor.

### 2.4 Seguridad informática (posible escenario adverso)

- El scraping NO accede a zonas autenticadas, NO usa credenciales de proveedores ni de la entidad, NO intenta evadir medidas de seguridad más allá de sortear el ReCaptcha público de navegación anónima.
- **Riesgo residual:** un tribunal podría interpretar el sorteo del ReCaptcha como evasión de una medida técnica de protección. Este es el punto legalmente más sensible. Se mitiga con:
  - Volumen conservador y ritmo humano.
  - Uso exclusivo de datos ya públicos.
  - Documentación de la decisión (este documento).
  - Plan de contingencia: si se recibe requerimiento de VORTAL/CCE, detener el scraper y pasarse a la fuente oficial o al acuerdo comercial de Fase 3.

---

## 3. Volumen conservador (implementado)

Las mitigaciones técnicas de la Fase 2 limitan el impacto y el riesgo de baneo/requerimiento:

| Medida | Implementación |
|---|---|
| Máx 1 raspada cada 15 min | Cron `*/15 * * * *` + guard `rateLimited` (Fase 2.7) |
| Delay 30–60s entre navegaciones | `randomDelay()` en `lib/vortalRateLimit.ts` |
| 1 proceso a la vez | Descarga de documentos secuencial por noticeUID |
| User-Agent rotativo | `pickUserAgent()` (4 UAs de Chrome) |
| Backoff exponencial | `withRetry()` ante fallos transitorios |
| Fallback a datos.gov.co | Circuit breaker tras 3 fallos (Fase 2.6): la fuente oficial sigue operando |
| Sin login | Solo zona pública anónima |
| Sin descargas agresivas | Máx 5 descargas concurrentes, 50MB por doc |

**Resultado:** el volumen de requests es comparable al de un usuario humano navegando el portal, no a una extracción masiva.

---

## 4. Riesgos residuales y plan de contingencia

| Riesgo | Nivel | Contingencia |
|---|---|---|
| Términos de uso prohíben scraping | Medio | Revisar texto vigente; si se confirma, evaluar desactivar o reducir aún más el volumen |
| ReCaptcha interpretado como evasión de medida de seguridad | Bajo-Medio | Volumen conservador; documentación; disposición a detener ante requerimiento |
| Cambios de UI rompen el scraper | Operativo | Selectores parametrizados en `config/vortal.ts`; fallback automático a SODA |
| Baneo de IP | Operativo | Rate limiting; fallback 1h; re-bootstrap de sesión |

**Límites honestos (qué NO hace el scraper):**
- No accede a procesos/documentos que requieran login de proveedor.
- No usa la información para fines distintos al análisis interno de oportunidades (no redistribuye masivamente).
- No suplanta a la fuente oficial: convive con la ingestión SODA y está subordinado a ella (fallback).

---

## 5. Decisión documentada

El usuario propietario de PliegoNaut acepta el riesgo legal descrito y autoriza la operación del scraper de VORTAL **en la zona pública, con volumen conservador y con el fallback a datos.gov.co activo**, entendiendo que:

1. La información es pública por Ley 1712.
2. El scraping se limita a lo publicado y accesible sin login.
3. Si VORTAL/CCE lo solicita, se detendrá el scraper y se migrará a la Fase 3 (acuerdo comercial).

> **Firma del usuario:** ______________________________________
> **Fecha:** ______________
> **Evidencia de revisión:** (URL o captura de los términos de uso revisados, si se obtienen)

---

## 6. Referencias

- Ley 1712 de 2012 — Transparencia y del derecho de acceso a la información pública: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=56882
- Art. 20 Ley 1712 — Reutilización de información pública
- CONPES 3920 de 2018 — Política de explotación de datos (Big Data)
- Ley 1581 de 2012 (Habeas Data) — no aplica a datos de personas jurídicas/entidades, pero se respeta el tratamiento
- datos.gov.co / Colombia Compra Eficiente — datos abiertos oficiales: https://www.colombiacompra.gov.co/transparencia/datos-abiertos
- Comunidad SECOP (VORTAL): https://community.secop.gov.co

> **Nota:** este documento no constituye asesoría legal profesional. Se recomienda consultar un abogado especializado en derecho de tecnologías/contratación pública antes de operar en producción.
