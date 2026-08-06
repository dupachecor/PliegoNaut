# Plan: Tiempo Real en PliegoNaut (Roadmap Híbrido)

**Estado:** Aprobado (enfoque híbrido secuencial por riesgo)
**Fecha:** 2026-08-05
**Autor:** Equipo PliegoNaut
**Decisión del usuario:** Implementar las 3 fases en orden (datos.gov.co → scraping VORTAL → acuerdo CCE), validando cada fase antes de avanzar. Scraper VORTAL con alcance completo: **detección de nuevos + descarga de pliegos**.

---

## 0. Contexto y problema

### 0.1 El problema
La búsqueda manual y el scanner automático consumen los datasets públicos de `datos.gov.co` (Socrata API). Verificado el 2026-08-05:
- El dataset `p6dx-8zbt` (SECOP II Procesos) se actualiza **una vez al día** (~5 AM) mediante un ETL batch de Colombia Compra Eficiente (CCE).
- La fecha máxima de publicación en el dataset es ~24h atrás (ayer).
- Esto deja sin margen a los procesos de plazo corto (mínima/menor cuantía: 1-2 días).

### 0.2 Verificación de la realidad
- **No existe API pública en tiempo real de SECOP.** La "API oficial" es datos.gov.co (Socrata, batch diario). La plataforma transaccional `community.secop.gov.co` (VORTAL) sí es tiempo real pero NO expone API pública (HTML+JS con ReCaptcha).
- El lag de ~24h es inherente al pipeline de CCE, no a datos.gov.co.
- **Análisis de días publicación → cierre** (muestra de 1,666 procesos, 10 departamentos): mediana 4 días, promedio 5 días. Licitación pública exige 10+ días hábiles legales → el lag es tolerable ahí; es crítico para mínima/menor cuantía.

### 0.3 Datasets utilizados actualmente
| Dataset | ID | Rol | Frecuencia |
|---------|-----|-----|-------------|
| SECOP II Procesos | `p6dx-8zbt` | Fuente primaria SECOP II (procesos) | Diaria |
| SECOP I Procesos | `f789-7hwg` | Alcaldías con `fecha_de_cargue_en_el_secop` real | Diaria |
| SECOP I Integrado | `rpmr-utcd` | Fallback para convocados de SECOP I (sin fecha) | Diaria |
| SECOP II Contratos | `jbjy-vk9h` | (No usado aún) Contratos firmados | Diaria |

### 0.4 Decisión
Implementar 3 fases de creciente riesgo y complejidad, validando cada una antes de avanzar:
1. **Fase 1 (🟢 bajo riesgo):** mejoras en datos.gov.co — pulls incrementales + multi-dataset + App Token.
2. **Fase 2 (🟡 alto riesgo):** scraper VORTAL — detección + descarga de pliegos, con fallback a datos.gov.co.
3. **Fase 3 (🔵 largo plazo):** acuerdo comercial con CCE/VORTAL para API transaccional.

---

## FASE 1 — Mejoras en datos.gov.co (Bajo Riesgo) 🟢

**Objetivo:** reducir el lag de detección dentro del día (no elimina el lag original de CCE) y enriquecer con 3 datasets cruzados.

> **Estado de implementación (2026-08-05):**
> | Sub-fase | Estado |
> |---|---|
> | 1.1 Pull incremental con watermark | ✅ Implementado |
> | 1.2 Combinar datasets con `source` | ✅ Implementado (incluye `rpmr-utcd` como `secop_i_integrado`) |
> | 1.3 App Token Socrata | ✅ Implementado y verificado (token activo en `.env`) |
> | 1.4 Migración `IngestLog` | ✅ SQL en `migrations/0001_init`; aplicada en PostgreSQL 16 local |
> | 1.5 Refactor `/api/search` | ✅ Caché + `source` + búsqueda DB (`SEARCH_USE_DB=true` activo, verificado <0.1s) |
> | 1.6 Monitoreo y alertas | ✅ Implementado (logs `[INGEST]` + webhook tras 3 fallos) |
> | 1.7 Criterios de salida | ⏳ Solo falta observación de 24h del cron y medición del lag |

**Pendiente para cerrar Fase 1:** dejar el cron corriendo 24h y confirmar `IngestLog`/lag; considerar si el volumen de matches de `secop_i_integrado` (~4.4k para TechNaut) es aceptable o se filtra más.

### 1.1 Sub-fase: Pull incremental con cursor de marca de agua

**Qué:** Reemplazar la lógica del scanner actual (`sodaScanner.ts`) por una ingestión incremental que solo trae registros nuevos desde la última ingesta.

**Archivos:**
- `apps/api/src/services/sodaIngestService.ts` (nuevo)
- `apps/api/src/services/sodaScanner.ts` (refactor o deprecate)
- `apps/api/src/cron/sodaIngest.ts` (nuevo, reemplaza el cron actual)

**Estrategia:**
- Query: `$where=fecha_de_ultima_publicaci >= '<ultima_ingesta>'` + `$order=fecha_de_ultima_publicaci DESC` + `$limit=1000` + paginación con `$offset`.
- Persistir `lastSeenPub` (marca de agua) en nueva tabla `IngestLog`.
- Cron cada **1 hora** (no cada 24h) — cuando CCE publique el batch diario, se detecta en minutos, no en 24h adicionales.

**Verificación (checkpoint):**
- [ ] Cron hourly ejecuta sin errores en 24h de observación
- [ ] `IngestLog` persiste correctamente la marca de agua
- [ ] No hay duplicados (dedup por `id_del_proceso`)

### 1.2 Sub-fase: Combinar 3 datasets con origen etiquetado

**Qué:** Enriquecer cada proceso con datos de 3 datasets cruzados.

**Estrategia:**
- **Procesos** (`p6dx-8zbt`) — fuente primaria SECOP II.
- **Contratos** (`jbjy-vk9h`) — para adjudicaciones: `proveedor_adjudicado`, `valor_del_contrato`.
- **SECOP Integrado** (`rpmr-utcd`) — para SECOP I (alcaldías).
- Etiquetar cada registro con `source` (`secop_ii` | `secop_i_integrado` | `secop_i_procesos`).
- Dedup estricto por `id_del_proceso` (mantener la fuente más fresca: `secop_ii` > `secop_i_procesos` > `secop_i_integrado`).

> **Nota de implementación:** `rpmr-utcd` carece de fecha utilizable como watermark para procesos abiertos
> (solo fecha de contrato firmado). Se ingesta con un `$where` fijo por estado
> (`upper(estado_del_proceso) = 'CONVOCADO'`) y el dedup por `id_del_proceso` evita duplicados entre
> ejecuciones. Activable con `INGEST_SECOP_INTEGRADO_ENABLED`.

**Verificación:**
- [x] Búsqueda manual muestra `source` en cada resultado (implementado y testeado)
- [x] Registros de SECOP I aparecen (alcaldías) — verificado en `/api/search` con datos reales
- [x] No hay duplicados entre datasets (dedup por `id_del_proceso` con tests)

### 1.3 Sub-fase: App Token Socrata

**Qué:** Registrar cuenta en datos.gov.co → obtener App Token gratuito → subir rate limit.

**Pasos:**
1. Registrarse en https://www.datos.gov.co/signup
2. Crear App Token en Settings → Developer Settings
3. Configurar `SOCRATA_APP_TOKEN` en `.env`
4. Pasar como header `X-App-Token` en `sodaClient` (`sodaScanner.ts:9`).

**Verificación:**
- [x] Header `X-App-Token` presente en requests (aplicado en ingest, `/api/search` y scanner legacy)
- [x] App Token válido: `curl` con header responde `200 OK` y `/api/search` trae datos reales
- [ ] Rate limit aumentado (datos.gov.co no expone `ratelimit-remaining`; con token no se throttlea por IP)

### 1.4 Sub-fase: Schema DB — modelo `IngestLog`

**Qué:** Nueva tabla para tracking de ingestión incremental.

```prisma
model IngestLog {
  id             String   @id @default(uuid())
  datasetId      String   // p6dx-8zbt, rpmr-utcd, etc.
  lastIngestAt   DateTime @default(now())
  lastSeenPub    DateTime // marca de agua para pulls incrementales
  recordsFetched Int      @default(0)
  status         String   @default("OK") // OK | ERROR
  errors         String   @default("")
  @@unique([datasetId])
}
```

**Migración:** `npx prisma migrate dev --name add_ingestlog`

> **Nota de implementación:** la migración se generó offline con `prisma migrate diff --from-empty
> --to-schema-datamodel` en `packages/database/prisma/migrations/0001_init/migration.sql` (sin necesidad
> de DB en ejecución). `docker-entrypoint.sh` ahora usa `npx prisma migrate deploy`.

**Verificación:**
- [x] SQL de migración generado y versionado (0001_init)
- [ ] Migración aplicada sobre una DB PostgreSQL real (pendiente: no hay DB local)
- [ ] `IngestLog` se actualiza tras cada cron
- [ ] Consulta `prisma.ingestLog.findUnique()` funciona

### 1.5 Sub-fase: Refactor del endpoint `/api/search`

**Qué:** La búsqueda manual ya funciona contra SODA en vivo; mantener, pero opcionalmente leer desde la DB enriquecida cuando exista.

**Estrategia:**
- Conservar la lógica de las 4 queries actuales como fallback directo a SODA.
- Agregar `source` a la respuesta (ya hecho).
- **Implementado:** caché de resultados de 15 min (`TtlCache`, `SEARCH_CACHE_TTL_MS` / `SEARCH_CACHE_MAX`).
- **Implementado:** búsqueda desde la DB enriquecida con `SEARCH_USE_DB=true` — lee `ContractMatch`
  ingerido (dedup por `secopId`, mismo shape de respuesta); si no hay datos o falla, cae a SODA en vivo.

**Verificación:**
- [x] `source` aparece en todos los resultados
- [x] Caché implementada y testeada (2ª búsqueda no llama a SODA)
- [ ] Búsqueda manual responde < 10s con datos enriquecidos (pendiente: requiere DB con datos ingeridos)

### 1.6 Sub-fase: Monitoreo y alertas

**Qué:** Logging estructurado de la ingestión incremental.

**Archivos:** `apps/api/src/cron/sodaIngest.ts`

**Logs clave:**
- `[INGEST] Dataset p6dx-8zbt: 50 nuevos registros, lastSeenPub=2026-08-05`
- `[INGEST] Sin cambios desde última ingesta`
- `[INGEST] Error: rate limit, reintentando en 60s`

**Verificación:**
- [x] Logs estructurados en stdout + `/tmp/pliegonaut-api.log` (Pino, `LOG_FILE`)
- [x] Alerta webhook tras 3 ingestas consecutivas fallidas (con tests: `sodaIngestCron.test.ts`, `alert.test.ts`)

### 1.7 Criterios de salida Fase 1
- [ ] Cron hourly ingesta sin errores en 24h de observación (verificado 2 ejecuciones manuales sin errores; resta la observación de 24h)
- [x] Búsqueda manual responde < 10s con datos enriquecidos — verificado: 0.045s–0.1s desde DB con `SEARCH_USE_DB=true` (vs ~45s contra SODA)
- [x] App Token configurado y sin throttling por IP
- [ ] Lag de detección (no publicación) < 1h desde que CCE actualiza el dataset (pendiente observación del cron hourly)
- [x] `IngestLog` persiste correctamente — verificado: 4 datasets con status OK y watermark avanzado (p6dx 2026-08-01, f789 2026-08-04, jbjy 2026-07-29)

> **Verificado 2026-08-05:** instalado PostgreSQL 16 local (sin Docker), migración `0001_init` aplicada,
> ingesta real contra SODA con App Token: 11.633 procesos únicos, 4.537 matches para TechNaut, **0 duplicados**.

**Tiempo estimado:** 2-3 días
**Riesgo:** bajo (API que ya usamos)

---

## FASE 2 — Scraper VORTAL (Alto Riesgo) 🟡

**Objetivo:** detección en tiempo real de nuevos procesos en `community.secop.gov.co` + descarga de pliegos. Fallback automático a datos.gov.co si el scraper falla.

### 2.0 Sub-fase: PoC de viabilidad (OBLIGATORIA antes de construir)

**Qué:** Validar si el scraping de VORTAL es viable técnicamente (sortear ReCaptcha).

**Archivos:** `apps/api/src/services/vortalScraperPoC.ts` (script experimental, Node) + `apps/worker-python/vortal_poc.py` (script experimental, Python)

**Opciones de solver de ReCaptcha:**
1. `2captcha` / `anti-captcha` (pago, ~$2 USD por 1000 captchas) — más fiable
2. `puppeteer-extra-plugin-stealth` + `puppeteer-extra-plugin-recaptcha` (gratuito, frágil)
3. Headless Chrome con `undetected-chromedriver`

**Objetivo de la PoC:**
- Cargar `community.secop.gov.co/Public/Tendering/ContractNoticeManagement/Index`
- Sortear ReCaptcha
- Renderizar la lista de avisos
- Extraer 1 proceso sin baneo

> **Estado de la PoC (2026-08-06):** ✅ **GO — validada con la estrategia C (manual + cookies).**
> | Hallazgo | Resultado |
> |---|---|
> | WAF (Azure Application Gateway) bloquea clientes HTTP planos (curl → 403) | ✅ Esperado |
> | WAF NO bloquea navegadores reales (headless ni headful) | ✅ La barrera NO es el WAF |
> | VORTAL muestra **intersticial de reCAPTCHA v2 checkbox** (sitekey `6LcMmakZ…`, título "ReCaptcha") en visitas nuevas | ⚠️ Barrera real |
> | Opciones gratuitas #2 y #3 (stealth/recaptcha-plugin y undetected-chromedriver) | ❌ No pasan el captcha solas |
> | **Estrategia C (manual + cookies): resolver el checkbox 1 vez en headful; la sesión se persiste** (`user_data`) y las siguientes navegaciones headless **NO muestran captcha** | ✅ **FUNCIONA** |
> | Búsqueda real: el grid no se puebla con params de URL; hay que hacer click en `#btnSearchButton` (formulario `frmMainForm`, campos fecha `dtmbPublishDateFrom/To_txt`) | ✅ Descubierto |
> | Extracción: el `noticeUID` vive en el `onclick` del link "Detalle" (`createAndOpenSupportModal`), formato `CO1.NTC.<id>` | ✅ Descubierto |
> | **Validación formal: 3/3 intentos, 100% éxito, 0 bloqueos, 0 captchas** (headless, sesión persistida) | ✅ **GO** |
>
> **Conclusión:** la Fase 2 es viable sin pagar solver. El diseño de producción será: (1) bootstrap manual único del captcha en headful → cookies persistidas en un volumen; (2) cron headless con esa sesión (re-solve manual puntual si VORTAL la invalida); (3) botón "Buscar" para poblar la grilla; (4) extracción del `noticeUID` desde el onclick del link Detalle.

**Verificación (GO/NO-GO):**
- [x] PoC sortea ReCaptcha con >80% de éxito tras 3 intentos (validada 3/3 = 100% con sesión persistida)
- [x] El WAF no banea al navegador (0 bloqueos en la validación)
- [x] Se extraen procesos reales (`noticeUID` como `CO1.NTC.10281640`)
- [ ] Si se invalida la sesión y NO se re-resuelve → documentar en `docs/SCRAPER_BLOCKED.md`

**Tiempo estimado PoC:** 1-2 días

### 2.1 Sub-fase: Scraper de detección de nuevos

**Qué:** Cron cada 15 min que navega la lista pública de avisos y detecta nuevos procesos.

> **Estado de implementación (2026-08-06):** ✅ implementado y verificado en vivo contra VORTAL.
> - `apps/api/src/services/vortalScraperService.ts` — navega la búsqueda con ventana de `newProcessWindowHours` (2h),
>   hace click en `#btnSearchButton`, extrae la grilla `VortalGrid` (noticeUID desde el onclick del link "Detalle"),
>   filtra estado `Publicado` + ventana, dedup por `vortalNoticeUid` y persiste en `ContractMatch`
>   (`source='vortal_scraped'`, `matchScore=90`, `PENDING_ANALYSIS`) para cada empresa.
> - `apps/api/src/cron/vortalScraper.ts` — cron `*/15 * * * *` (guarda por env `VORTAL_CRON_SCHEDULE`), activable con
>   `VORTAL_SCRAPER_ENABLED=true`.
> - Registra cada ejecución en `ScrapeSession` (OK / FAILED / BLOCKED). Sesión persistida en `storage/vortal/user_data`
>   (bootstrap: `VORTAL_HEADFUL=true` resuelve el captcha 1 vez).
> - Verificado en vivo: 2 procesos nuevos persistidos con fechas correctas, dedup en re-ejecución (0 duplicados),
>   ruta BLOCKED sin sesión válida.

**Archivos:**
- `apps/api/src/services/vortalScraperService.ts` (nuevo)
- `apps/api/src/cron/vortalScraper.ts` (nuevo)
- `apps/api/src/config/vortal.ts` (selectores parametrizados + ventana + sesión + chromium)

**Pila técnica:**
- Playwright (más estable que Puppeteer para SPAs)
- `playwright-extra` + `puppeteer-extra-plugin-stealth`

**Flujo:**
1. Navegar a la lista pública de avisos filtrada por departamento/estado "Publicado".
2. Esperar renderizado (Angular SPA).
3. Extraer: `noticeUID`, entidad, objeto, fechas, presupuesto, URL.
4. Para cada proceso nuevo (`noticeUID` no en DB), encolar trabajo de descarga de pliegos.
5. Persistir en `ContractMatch` con `source = 'vortal_scraped'` y `vortalNoticeUid`.
6. Ventana de tiempo: raspar solo avisos publicados en las últimas 2 horas.

**Verificación:**
- [ ] Cron 15-min ejecuta sin baneo en 24h
- [ ] Nuevos procesos detectados < 30 min tras publicación en VORTAL
- [ ] No hay falsos positivos (validar contra datos.gov.co)

### 2.2 Sub-fase: Descarga de pliegos

**Qué:** Para cada proceso nuevo, descargar los documentos (pliego de condiciones, addendos, avisos, anexos).

> **Estado de implementación (2026-08-06):** ✅ implementado y verificado en vivo contra VORTAL.
> - Mecanismo descubierto: el detalle (`OpportunityDetail/Index?noticeUID=…`) lista TODOS los documentos;
>   cada "Descargar" llama a `DownloadFile?documentFileId=<id>&mkey=<sesión>`, que responde un redirect vía JS a
>   `/Public/Archive/RetrieveFile/Index?DocumentId=<id>`, que devuelve el PDF.
> - `apps/api/src/services/vortalDocumentsService.ts` — extrae TODOS los refs del detalle (con `inferDocumentType`
>   por nombre: pliego/addendo/aviso/anexo), descarga con Node fetch + cookies del navegador (pool de
>   `maxConcurrentDownloads`=5, timeout `downloadTimeoutMs`=120s, máx `maxDocSizeMB`=50MB), valida `%PDF-`,
>   guarda en `storage/pliegos/{secopId}/{docId}.pdf` y registra en `ProcessDocument` (checksum SHA256, upsert dedup).
> - `apps/api/src/services/documentsStorageService.ts` — `sha256`, `looksLikePdf`, `buildStoragePath`, `savePdf`, `exceedsMaxSize`.
> - Integrado en `runVortalScrape`: tras persistir nuevos, descarga sus documentos y actualiza `ScrapeSession.newDocuments`.
> - Verificado en vivo: proceso con 7 docs → 7/7; otro con 10 (una duplicada deduped) → 10/10; otro con 3 → 3/3;
>   total 24 documentos en una ejecución; re-ejecución sin duplicados (upsert por `@@unique`).

**Archivos:**
- `apps/api/src/services/vortalDocumentsService.ts` (nuevo)
- `apps/api/src/services/documentsStorageService.ts` (nuevo)

**Flujo:**
1. Navegar al detalle del proceso (`noticeUID`).
2. Ir a la pestaña "Documentos".
3. Iterar la lista de documentos (pliego, addendos, avisos).
4. Descargar cada PDF a `storage/pliegos/{secopId}/{docId}.pdf`.
5. Calcular checksum SHA256 para dedup.
6. Metadatos en nueva tabla `ProcessDocument`.
7. Procesar en background (no bloquear la ingestión).

**Límites:**
- Tamaño máx por documento: 50MB
- Timeout por descarga: 120s
- Máx 5 descargas concurrentes

**Verificación:**
- [ ] Pliegos descargados correctamente para ≥ 70% de procesos nuevos
- [ ] PDFs válidos (no HTML de error)
- [ ] Checksums calculados y dedup funciona
- [ ] Descargas en background no bloquean el scraper

### 2.3 Sub-fase: Schema DB — modelos nuevos

```prisma
model ProcessDocument {
  id           String   @id @default(uuid())
  contractId   String   // FK a ContractMatch.id
  documentType String   // pliego, addendo, aviso
  vortalDocId  String?
  fileName     String
  storagePath  String   // ruta local al PDF
  downloadUrl  String
  contentType  String   @default("application/pdf")
  sizeBytes    Int?
  checksum     String?  // sha256 para dedup
  fetchedAt    DateTime @default(now())
  @@index([contractId])
  @@unique([contractId, documentType, vortalDocId])
}

model ScrapeSession {
  id            String    @id @default(uuid())
  startedAt     DateTime  @default(now())
  completedAt   DateTime?
  status       String    @default("RUNNING") // RUNNING | OK | FAILED | BLOCKED
  newProcesses Int       @default(0)
  newDocuments  Int       @default(0)
  errors        String    @default("")
  captchaSolved Boolean?
  fallbackUsed  Boolean   @default(false)
}
```

**Migración:** `npx prisma migrate dev --name add_process_documents_and_scrape_sessions`

**Verificación:**
- [ ] Migración aplica sin errores
- [ ] Modelos accesibles via Prisma Client
- [ ] Índices creados correctamente

### 2.4 Sub-fase: API endpoints nuevos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/contracts/:secopId/documents` | Lista de pliegos disponibles |
| GET | `/api/contracts/:secopId/documents/:docId/download` | Streaming del PDF |

**Archivos:**
- `apps/api/src/routes/documents.ts` (nuevo)
- Modificar `apps/api/src/index.ts` para registrar la ruta

**Verificación:**
- [ ] Endpoint devuelve lista de documentos
- [ ] Download stream funciona con PDFs válidos
- [ ] Auth API Key requerida

### 2.5 Sub-fase: Frontend — botón "Ver pliego"

**Qué:** En cada tarjeta de contrato, agregar boton que abre/descarga el pliego.

**Archivos:**
- `apps/web/src/components/dashboard/SearchPanel.tsx` (modificar)
- `apps/web/src/lib/api.ts` (agregar `fetchDocuments`)

**Verificación:**
- [ ] Botón visible solo si hay documentos
- [ ] Click descarga/abre el PDF
- [ ] Loading state mientras descarga

### 2.6 Sub-fase: Fallback automático

**Qué:** Si el scraper falla 3 veces consecutivas, conmutar a datos.gov.co.

**Archivos:** `apps/api/src/services/vortalScraperService.ts`

**Lógica:**
- Detectar 3 fallos consecutivos (ReCaptcha no resuelta, ban, 5xx).
- Setear `useScraper = false` durante 1h.
- Mientras tanto, `sodaIngestService` (Fase 1) sigue proveyendo datos con lag de 24h.
- Log claro: `[VORTAL] Fallback activado - ReCaptcha bloqueado`.
- Auto-recuperación: tras 1h, reintentar PoC de ReCaptcha.

**Verificación:**
- [ ] Fallback se activa tras 3 fallos
- [ ] Servicio sigue funcionando vía datos.gov.co
- [ ] Auto-recuperación tras 1h
- [ ] Logs claros

### 2.7 Sub-fase: Robustez y rate limiting auto-impuesto

**Qué:** Evitar baneo de IP por parte de VORTAL.

**Reglas:**
- Máx 1 raspada cada 15 min
- 1 proceso a la vez (no paralelizar descargas)
- Delay 30-60s entre requests
- User-Agent rotativo
- Manejo de sesión (cookies)
- Reintentar con backoff exponencial

**Verificación:**
- [ ] No baneo en 48h de operación
- [ ] Delays respetados
- [ ] Backoff funcional

### 2.8 Sub-fase: Documento de riesgo legal

**Qué:** Documentar la decisión de scraping con análisis legal.

**Archivo:** `docs/SCRAPER_RISK.md`

**Contenido:**
- Análisis de Ley 1712 de Transparencia (ampara reuso de datos públicos)
- Términos de uso de VORTAL (podrían limitar scraping automatizado)
- Volumen conservador (no agresivo)
- Uso solo de lo público sin login
- Decisión documentada por el usuario

**Verificación:**
- [ ] Documento creado
- [ ] Usuario revisa y firma/evidencia

### 2.9 Criterios de salida Fase 2
- [ ] PoC sortea ReCaptcha fiablemente (>80% éxito)
- [ ] Cron 15-min detecta nuevos procesos < 30 min tras publicación en VORTAL
- [ ] Pliegos descargados correctamente para ≥ 70% de procesos nuevos
- [ ] Fallback a datos.gov.co se activa sin interrupción de servicio
- [ ] No baneo en 48h de operación
- [ ] `SCRAPER_RISK.md` revisado por el usuario

**Tiempo estimado:** 5-8 días (si PoC OK)
**Riesgo:** alto
**Si PoC falla:** desistir y dejar Fase 1 como solución final + acelerar Fase 3

---

## FASE 3 — Acuerdo Comercial con CCE/VORTAL (Largo Plazo) 🔵

**Objetivo:** reemplazar el scraper frágil por un canal oficial/comercial de acceso a tiempo real.

### 3.1 Sub-fase: Inventario de contacto y procesos

**Qué:** Documentar PQRSD a radicar ante CCE y contacto con VORTAL.

**Archivos:**
- `docs/comercial/CCE_PQRSD.md` (nuevo)
- `docs/comercial/VORTAL_OUTREACH.md` (nuevo)

**PQRSD a CCE (https://www.colombiacompra.gov.co/pqrsd):**
- Solicitar acceso a API transaccional de SECOP II (si existe bajo NDA)
- Solicitar inclusión como stakeholder de datos abiertos para feed en tiempo real
- Posibilidad de webhooks por entidad/UNSPSC

**Contacto VORTAL (vortal.com):**
- Licenciar su API/integración propia
- Acuerdo de acceso a datos para inteligencia de mercado

**Verificación:**
- [ ] PQRSD radicada con número de radicado
- [ ] Email enviado a VORTAL
- [ ] Seguimiento programado

### 3.2 Sub-fase: Dossier técnico

**Qué:** Preparar dossier de caso de uso para incluir en comunicaciones.

**Contenido:**
- Caso de uso (inteligencia de oportunidades para pymes)
- Volumen actual de consumo (logs de Fase 1)
- Beneficio para la transparencia (alineado con misión de CCE)
- Arquitectura técnica actual
- Métricas de uso

**Verificación:**
- [ ] Dossier creado
- [ ] Revisado por el usuario

### 3.3 Sub-fase: Implementación (condicional a acuerdo)

**Qué:** Solo si se obtiene acceso, crear servicio que reemplace al scraper.

**Archivos:**
- `apps/api/src/services/vortalApiService.ts` (nuevo)
- Parametrizar fuente vía env `SECOP_SOURCE = soda | vortal_scrape | vortal_api`

**Verificación:**
- [ ] API oficial integrada
- [ ] Scraper retirado (si API funciona)
- [ ] Fallback a datos.gov.co mantenido

### 3.4 Criterios de salida Fase 3
- [ ] PQRSD radicada con número de radicado
- [ ] Respuesta formal recibida (aún si negativa → documentar y cerrar)
- [ ] En caso positivo: integración implementada y scraper retirado

**Tiempo estimado:** 2-4 semanas (depende del ente)
**Riesgo:** bajo (no rompe nada si no funciona)

---

## Arquitectura Objetivo

```
                ┌─────────────────────────────────────────────┐
                │            PliegoNaut API (Node)             │
                │                                             │
   Fase 1 ──────┤  sodaIngestService (pulls incrementales)     │  datos.gov.co
                │     ↑ cada 1h   ↑ App Token Socrata           │  (fallback robusto)
                │                                             │
                │  contractsService (lectura enriquecida)       │
                │                                             │
   Fase 2 ──────┤  vortalScraperService (nuevos + pliegos)     │  VORTAL
                │     ↑ cron 15 min  ↑ ReCaptcha solver        │  (tiempo real)
                │     ↓                                        │  (alto riesgo)
                │  documentsService (almacena pliegos PDF)     │
                │  vortalFallback → sodaIngestService           │
                │                                             │
   Fase 3 ──────┤  vortalApiService (si se logra acuerdo)      │  CCE/VORTAL
                │     ↓                                        │  (largo plazo)
                │  reemplaza al scraper de Fase 2               │
                └─────────────────────────────────────────────┘
                            ↓
                   PostgreSQL (Prisma)
                   - ContractMatch (procesos)
                   - ProcessDocument (pliegos) ← nuevo modelo
                   - IngestLog (dedup/origen) ← nuevo modelo
                   - ScrapeSession (monitor scraper) ← nuevo modelo
```

---

## Riesgos y Mitigaciones

| Riesgo | Fase | Mitigación |
|---|---|---|
| ReCaptcha bloquea el scraper | 2 | PoC obligatoria antes de construir; fallback a datos.gov.co automático |
| Baneo de IP por VORTAL | 2 | Rate limiting auto-impuesto, rotación UA, delays 30-60s |
| Lag de 24h sigue dentro del día | 1 | Pull hourly; el análisis mostró que las licitaciones (10+ días) toleran bien el lag |
| Cambios en la UI de VORTAL rompen el scraper | 2 | Selectores parametrizados en `config/vortal.ts`; alerts ante fallos; fallback instantáneo |
| TOS / legalidad del scraping | 2 | Documento de decisión firmado; volumen conservador; usar solo lo público sin login |
| Costo de solver de ReCaptcha | 2 | ~$2/1000 captchas — iniciar con crédito de prueba; revisar costo/mes |
| Schema cambia | 1-3 | Migraciones incrementales Prisma, sin breaking changes para endpoints existentes |
| Acuerdo CCE se demora años | 3 | Es paralelo, no bloqueante; mientras Fase 2 funciona |

---

## Orden de Ejecución

1. **Fase 1** completa y validada (criterios de salida verdes) → pasar a Fase 2.
2. **Fase 2 PoC** primero → si verde, construir scraper completo; si roja, saltar a Fase 3 y dejar Fase 1 como definitiva.
3. **Fase 3** en paralelo con el contacto comercial desde que empieza Fase 2 (no requiere código).

---

## Dependencias y Entorno

### Variables de entorno nuevas
| Variable | Fase | Descripción |
|----------|------|-------------|
| `SOCRATA_APP_TOKEN` | 1 | App Token gratuito de datos.gov.co |
| `SECOP_SOURCE` | 2-3 | `soda` \| `vortal_scrape` \| `vortal_api` |
| `TWOCAPTCHA_API_KEY` | 2 | API key del solver de ReCaptcha |
| `VORTAL_BASE_URL` | 2 | URL base de community.secop.gov.co |
| `VORTAL_API_KEY` | 3 | (Si se obtiene acuerdo) API key oficial |

### Paquetes npm nuevos (Fase 2)
- `playwright`
- `playwright-extra`
- `puppeteer-extra-plugin-stealth`
- `2captcha` (o SDK equivalente)

### Migraciones Prisma
1. `add_ingestlog` (Fase 1)
2. `add_process_documents_and_scrape_sessions` (Fase 2)

### Tests
- Vitest (ya en el repo) — añadir unit tests para `IngestLog`, cursor incremental, y mocks del scraper.

---

## Áreas de Mejora Adicionales (No bloqueantes)

Estas mejoras no son parte del plan de tiempo real pero se pueden abordar en paralelo:

### A. Detección de fraccionamiento de contratos
- Agrupar contratos del mismo objeto/entidad para detectar si "picaron" uno grande en varios pequeños.
- Señal de corrupción: plazo corto + cuantía alta + un solo oferente + mismo contratista.

### B. Scoring de riesgo de corrupción
- Marcar procesos con plazo anormalmente corto para su cuantía/modalidad.
- Combinar: plazo corto (≤3 días) Y cuantía alta (>500 SMMLV) Y modalidad que exija plazo mayor.

### C. Notificaciones push
- Webhooks/email cuando se detecte un proceso que coincide con el perfil de la empresa.
- Reducir aún más el tiempo de reacción.

### D. Búsqueda por departamento completo
- Agregar opción de buscar todo el departamento sin elegir municipio.
- Útil para municipios pequeños que publican poco.

### E. Histórico de adjudicaciones
- Cruzar con dataset `jbjy-vk9h` (Contratos Electrónicos) para mostrar historial de adjudicaciones de cada entidad.
- Detectar patrones de mismo proveedor.

---

## Lo que el plan NO hace (límites honestos)

1. **No elimina el lag de 24h de CCE** — eso es del pipeline de CCE, no nuestro. La Fase 1 lo mitiga detectando dentro del día; la Fase 2 lo elimina para los procesos que VORTAL expone públicamente.
2. **No accede a procesos que las entidades no publiquen en VORTAL público** — algunos procesos requieren login de proveedor.
3. **No descarga documentos que requieran login de proveedor** — solo los públicos.
4. **No garantiza acceso a tiempo real si VORTAL bloquea el scraper** — por eso hay fallback a datos.gov.co y Plan B con CCE.

---

## Análisis de días publicación → cierre (referencia)

**Muestra:** 1,666 procesos en 10 departamentos (SECOP II, verificado 2026-08-05).

| Departamento | n | Promedio | Mediana | Mín | Máx |
|---|---|---|---|---|---|
| Antioquia | 100 | 8.2d | 6d | 0d | 33d |
| Valle del Cauca | 99 | 6.8d | 5d | 0d | 45d |
| Caldas | 195 | 6.3d | 4d | 0d | 38d |
| Santander | 298 | 5.5d | 4d | -22d | 28d |
| Tolima | 195 | 5.4d | 5d | 0d | 42d |
| Risaralda | 190 | 4.6d | 4d | 0d | 22d |
| Cauca | 96 | 4.5d | 2d | 0d | 38d |
| Magdalena | 196 | 4.3d | 4d | 1d | 21d |
| Huila | 98 | 2.9d | 1d | 0d | 34d |
| Cundinamarca | 199 | 2.5d | 2d | 0d | 17d |

**Total:** 5.0 días promedio, mediana ~4 días.

**Implicación:** el lag de 1 día deja ~3 días para la mitad de los procesos. Para licitaciones públicas (10+ días legales), el lag es insignificante.

---

## Referencias

- Página oficial de Datos Abiertos CCE: https://www.colombiacompra.gov.co/transparencia/datos-abiertos
- Dataset procesos: https://www.datos.gov.co/resource/p6dx-8zbt.json
- Dataset contratos: https://www.datos.gov.co/resource/jbjy-vk9h.json
- Dataset SECOP Integrado: https://www.datos.gov.co/resource/rpmr-utcd.json
- SECOP I vigente: https://www.datos.gov.co/resource/f789-7hwg.json
- Docs API (Socrata): https://dev.socrata.com
- Plataforma transaccional (scraping, con riesgo): https://community.secop.gov.co
- PQRSD CCE (para pedir acceso formal): https://www.colombiacompra.gov.co/pqrsd