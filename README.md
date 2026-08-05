# PliegoNaut

**Plataforma inteligente de analisis y scoring de licitaciones publicas colombianas (SECOP I + II) mediante agentes de IA.**

PliegoNaut automatiza el ciclo completo de identificacion, descarga, analisis y scoring de Pliegos de Condiciones del SECOP. Combina un escaner de contratos publicos que consulta tanto SECOP II (via SODA API de datos.gov.co) como SECOP I (Alcaldias y entidades que publican en contratos.gov.co), con un pipeline de agentes de IA (CrewAI) que simula un equipo de analistas juridicos y financieros, emitiendo un veredicto estructurado y un puntaje de viabilidad para cada licitacion.

> **Estado actual de la fuente de datos:** los datasets publicos de datos.gov.co (Socrata) se actualizan una vez al dia (batch ETL de Colombia Compra Eficiente), con un retraso inherente de ~24h entre publicacion en SECOP y disponibilidad en la API. Ver `docs/PLAN_TIEMPO_REAL.md` para el roadmap de mitigacion (pulls incrementales + scraping VORTAL + acuerdo comercial CCE).

---

## Arquitectura del Sistema

```
                    +------------------+       +------------------+
                    |   Next.js 15     |       |   Express API    |
                    |   Dashboard      |       |   (Node.js)      |
                    |   (port 3000)    |       |   (port 3001)    |
                    +--------+---------+       +--------+---------+
                             |                          |
                             | HTTP (Proxy)              | WebSocket
                             |                          |
+--------+--------------------------+---------+
                     |                    API                              |
                     |  - SODA Scanner (SECOP II + SECOP I integrado)     |
                     |  - Busqueda Manual (dual-query $q + $where)        |
                     |  - CRON scheduler                                  |
                     |  - Rate limiting / Auth (API Key + JWT)            |
                     |  - Prisma ORM (PostgreSQL)                         |
                     +---------------------------+------------------------+
                                                  |
                                     +------------+------------+
                                     |   PostgreSQL 16        |
                                     |   (Docker)             |
                                     +------------------------+
                                                  |
                                     +------------+------------+
                                     |   Python Worker          |
                                     |   (CrewAI + LLM)        |
                                     |                         |
                                     |  Fase B1: PDF Download  |
                                     |  Fase B2: OCR/Extraccion|
                                     |  Fase C: Analisis IA    |
                                     +-------------------------+
```

### Flujo de Datos

```
Fuentes de datos (datos.gov.co - Socrata API):
  - SECOP II Procesos      (p6dx-8zbt)  -> procesos de contratacion
  - SECOP I Procesos       (f789-7hwg)  -> procesos de alcaldias (con fecha de cargue)
  - SECOP I Integrado      (rpmr-utcd)  -> fallback para convocados de SECOP I
        |
        | SODA Query (municipio, departamento, UNSPSC, presupuesto)
        v
  API Server (Node.js/Express)
        |
        |  Busqueda manual: 3 queries combinadas
        |    Query 1: $q municipio (full-text SECOP II)
        |    Query 2: $q municipio + dept (SECOP II por departamento)
        |    Query 3: SECOP I Procesos (f789-7hwg) por departamento
        |    Query 3c: SECOP Integrado (rpmr-utcd) fallback por municipio
        |  -> merge + dedup por id_del_proceso
        |  -> filtro estricto de municipio client-side
        |  -> calculo isExpired (fecha recepcion + estado + antiguedad)
        |  -> sort estricto por fecha de publicacion DESC
        |
        | Prisma batch create (scanner automatico por empresa)
        v
  PostgreSQL (ContractMatch: PENDING_ANALYSIS)
        |
        | HTTP Polling / WebSocket
        v
  Python Worker
        |
        |--- Fase B1: Playwright -> PDF Download (SECOP web)
        |--- Fase B2: marker-pdf (GPU/CUDA) o pdfplumber -> Markdown
        |--- Fase C: CrewAI Agents (Legal -> Financial -> Judge)
        |
        | PATCH /api/worker/tasks/:id/analysis
        v
  PostgreSQL (ContractMatch: VIABLE | REJECTED)
        |
        v
  Next.js Dashboard (React Query polling 5s)
```

---

## Componentes del Sistema

### 1. API REST (Node.js/Express + TypeScript)

Servidor principal que orquesta el sistema. Proporciona endpoints REST y WebSocket para la comunicacion entre todos los componentes.

**Endpoints:**

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/api/health` | No | Health check del servidor |
| GET | `/api/companies` | No | Lista todas las empresas registradas |
| POST | `/api/companies` | API Key | Registra una nueva empresa |
| GET | `/api/contracts/:companyId` | No | Contratos asociados a una empresa |
| POST | `/api/trigger-scanner` | API Key | Dispara escaneo automatico de SECOP por empresa |
| POST | `/api/search` | API Key | Busqueda manual ad-hoc en SECOP (I+II) con filtros |
| GET | `/api/worker/tasks` | Worker Key | Obtiene tareas pendientes (hasta 5) |
| PATCH | `/api/worker/tasks/:id/analysis` | Worker Key | Envia resultado del analisis IA |
| GET | `/api/worker/health` | No | Health check para Docker |

**Caracteristicas tecnicas:**
- Rate limiting: 100 requests/15 min por IP en `/api/`
- Autenticacion por Bearer token con comparacion en tiempo constante
- Logging estructurado con Pino
- Validacion de schemas con Zod
- CRON programable (por defecto cada hora) para escaneo SECOP automatico
- Monitor de tareas estancadas: tasks en estado `PROCESSING` por mas de 1 hora se reinician a `PENDING_ANALYSIS`
- WebSocket server en `/api/worker/stream` con autenticacion token y heartbeat cada 30s

#### Busqueda Manual (`POST /api/search`)

Busqueda ad-hoc en SECOP (I + II) sin filtro de empresa. Combina 4 queries SODA y fusiona resultados:

| Query | Dataset | Estrategia | Captura |
|-------|---------|-----------|---------|
| 1 | `p6dx-8zbt` (SECOP II) | `$q` municipio (full-text) | Entidades/descripciones que mencionan el municipio |
| 2 | `p6dx-8zbt` (SECOP II) | `$q` municipio + departamento | Procesos del departamento por relevancia |
| 3 | `f789-7hwg` (SECOP I) | `$where` departamento | Procesos de alcaldias con `fecha_de_cargue_en_el_secop` real |
| 3c | `rpmr-utcd` (Integrado) | `$where` municipio + Convocado | Fallback para convocados no capturados por Query 3 |

**Post-procesamiento client-side:**
- Merge + dedup por `id_del_proceso` (SECOP II tiene prioridad)
- Filtro estricto de municipio (`ciudad_entidad` debe coincidir; elimina falsos positivos como Neiva/Algeciras)
- Calculo de `isExpired`: fecha de recepcion de ofertas > hoy, estado activo, apertura Abierta, antiguedad < 90 dias (SECOP II) / 540 dias (SECOP I)
- Sort estricto por `fecha_de_publicacion_del` DESC (recientes primero)
- Limite de timeout de SODA: 120s (`SODA_API_TIMEOUT`)
- Manejo de rate-limit de SODA: respuesta 429 con mensaje amigable

**Filtros soportados:**
- `municipio` + `department` (requiere seleccionar departamento primero en la UI)
- `minBudget` / `maxBudget`
- `unspscCodes` (array)
- `status` (array de estados; default incluye todos)
- `searchText` (texto libre en descripción)

**Respuesta:** Cada contrato incluye `isExpired`, `isOpen`, `awarded`, `modality`, `source` (`secop_ii` | `secop_integrado`).

### 2. Frontend (Next.js 15 + React + TypeScript)

Dashboard de usuario para visualizar y gestionar resultados.

**Paginas:**
- `/login` - Autenticacion por credenciales (NextAuth)
- `/` - Dashboard principal con tabla de contratos, analiticas y selector de empresas

**Componentes principales:**
- `DashboardClient` - Orquestador principal con polling cada 5s, sidebar + main layout
- `CompanySelector` - Lista de empresas registradas (skeleton loading)
- `AnalyticsSummary` - 4 tarjetas: Total, Viables, En Analisis, Descartadas
- `ContractsTable` - Tabla con columnas: Entidad/Titulo, Presupuesto, Estado, Score, Acciones
- `ContractDetailsModal` - Modal con 3 tabs: Resumen Ejecutivo, Analisis Legal, Analisis Financiero
- `SearchPanel` - Busqueda manual en SECOP (I+II) con filtros por departamento/municipio, presupuesto, texto libre y casilla "Solo no vencidos"
- `FilterBar` - Filtros laterales (estado, presupuesto, departamento, municipio, UNSPSC) con datos dinamicos de `colombia-territorial`

**Busqueda Manual (SearchPanel):**
- Selector encadenado Departamento → Municipio (datos oficiales via paquete `colombia-territorial`)
- Campos: texto libre, presupuesto min/max, departamento, municipio
- Casilla **"Solo no vencidos"** que filtra client-side por `isExpired !== true`
- Resultados ordenados estrictamente por fecha de publicacion DESC (recientes primero)
- Manejo de error de rate-limit de SODA con aviso amigable
- Cada tarjeta muestra: entidad, titulo, presupuesto, modalidad (SECOP I), estado (Activo/Vencido en verde/rojo), link a SECOP

**Estados visuales:**
- `En Cola` - Amarillo, pendiente de analisis
- `Analizando (IA)` - Azul con animacion pulse
- `Viable` - Verde
- `Descartada` - Rojo
- Score badges: verde (>80), amber (50-79), rojo (<50)

**Tecnologias:**
- Tailwind CSS v3.4 con `tailwindcss-animate`
- shadcn/ui (New York style): Button, Card, Badge, Avatar, Dialog, Tabs, Table, Skeleton, DropdownMenu
- TanStack React Query v5 para fetching con polling
- NextAuth v4 con estrategia JWT

### 3. Worker Python (CrewAI + LLM)

Nucleo inteligente del sistema. Procesa cada contrato en 3 fases secuenciales.

#### Fase B1: Descarga de PDF (DescargadorSECOP)

- Utiliza **Playwright** (Chromium headless) para navegar automaticamente al URL del proceso SECOP
- Localiza la pestana "Documentos" mediante multiples selectores adaptativos
- Encuentra el archivo "Pliego de Condiciones" usando patrones de busqueda
- Descarga el PDF a `./documentos/pdf_crudos/`
- Reutiliza la instancia del navegador entre descargas para eficiencia
- Gestion de senales para limpieza graceful de recursos

#### Fase B2: OCR a Markdown (OCRExtractor)

- **Primario**: `marker-pdf` con aceleracion GPU (CUDA, compatible con RTX 4060 Ti / 16GB VRAM)
- **Fallback**: `pdfplumber` cuando marker-pdf no esta disponible
- Extraccion pagina por pagina con deteccion y formateo de tablas
- Paginacion configurable via `MAX_OCR_PAGES` (default: 50)
- Salida en Markdown guardada en `./documentos/markdown/`

#### Fase C: Analisis con Agentes de IA (CrewAI)

Sistema multi-agente con **3 agentes especializados** en pipeline secuencial:

```
Pliego (Markdown) + Perfil de Empresa
        |
        v
[Analista Legal] ---> ReporteLegal (riesgos habilitantes, polizas, experiencia)
        |
        v
[Analista Financiero] ---> ReporteFinanciero (liquidez, capital trabajo, anticipos)
        |
        v
[Juez Final] ---> VeredictoFinal (viable, score 0-100, resumen ejecutivo)
```

**Agentes:**
1. **Analista Juridico** - Revisa requisitos legales, certificaciones, RUP, polizas, experiencia habilitante. Cita pagina exacta del pliego.
2. **Analista Financiero** - Evalua presupuesto, forma de pago, liquidez, capital de trabajo vs. requerido.
3. **Juez Final / Comite Estructurador** - Agrega ambos reportes y emite veredicto final con score 0-100.

**Modelos de salida (Pydantic):**
- `Hallazgo`: descripcion, pagina citada, cumple/no cumple
- `ReporteLegal`: lista de hallazgos, viabilidad legal
- `ReporteFinanciero`: analisis de indicadores, forma de pago, viabilidad financiera
- `VeredictoFinal`: viable (bool), score (0-100), resumen ejecutivo, causales de rechazo

**Configuracion LLM:**
- **Provider**: Ollama (local, default) o Gemini API
- **Modelo default**: `deepseek-r1:8b` via Ollama
- **Alternativa**: `gemini-2.0-flash` (requiere `GEMINI_API_KEY`)
- **Temperature**: 0.3 (baja, para analisis estructurado y consistente)

#### RAG Pipeline (Opcional)

`rag_pliego.py` implementa un sistema de Retrieval-Augmented Generation para pre-filtrar el pliego:
- Chunking con `RecursiveCharacterTextSplitter` (1500 chars, overlap 300)
- Embeddings con ChromaDB in-memory (modelo `all-MiniLM-L6-v2`)
- Dos consultas especializadas: legal y financiera
- Devuelve los top-K fragmentos mas relevantes para reducir contexto del LLM

### 4. Base de Datos (PostgreSQL + Prisma ORM)

Dos modelos principales:

**Company**
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| id | UUID | Primary Key |
| name | String | Nombre de la empresa |
| nit | String (unique) | Numero de identificacion tributaria |
| workingCapital | Float | Capital de trabajo disponible |
| liquidity | Float | Indice de liquidez |
| unspscCodes | String | Codigos UNSPSC separados por coma |
| regions | String | Departamentos/regiones de interes |
| emails | String | Correos de notificacion |
| minBudget | Float | Presupuesto minimo (default: 0) |
| maxBudget | Float | Presupuesto maximo (default: 9,999,999,999) |
| certifications | String | Certificaciones en JSON array |
| contracts | ContractMatch[] | Relacion 1:N |

**ContractMatch**
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| id | UUID | Primary Key |
| companyId | UUID | FK -> Company (cascade delete) |
| secopId | String | ID del proceso SECOP |
| entity | String | Entidad contratante |
| title | String | Descripcion del contrato |
| budget | Float | Presupuesto oficial |
| urlPliego | String | URL del proceso en SECOP |
| status | String | PENDING_ANALYSIS / PROCESSING / VIABLE / REJECTED |
| phase | String | Fase del proceso (Presentacion de oferta, etc.) |
| contractStatus | String | Estado del procedimiento en SECOP (Publicado, Convocado, etc.) |
| department | String | Departamento de la entidad |
| region | String | Region |
| categoryCode | String | Codigo UNSPSC |
| publishedAt | DateTime? | Fecha de publicacion del proceso |
| closingDate | DateTime? | Fecha de cierre/recepcion de ofertas |
| presentationDeadline | DateTime? | Plazo de presentacion |
| viabilityScore | Int? | Score 0-100 |
| reportLegal | String? | Reporte legal (JSON) |
| reportFinancial | String? | Reporte financiero (JSON) |
| reportFinal | String? | Veredicto final (JSON) |
| notified | Boolean | Notificacion enviada? |

> **Nota:** La busqueda manual (`/api/search`) retorna campos adicionales efimeros no persistidos: `isExpired`, `isOpen`, `awarded`, `modality`, `source`. El modelo Prisma `ContractMatch` se mantiene para el scanner automatico por empresa y el pipeline de IA.

**Indices:** `@@unique([companyId, secopId])`, `@@index([status])`, `@@index([createdAt])`, `@@index([companyId])`

### 5. Paquetes Compartidos

- **`@pliegonaut/database`** - Singleton de PrismaClient con caching global para hot-reload
- **`@pliegonaut/types`** - Interfaces TypeScript compartidas: Company, ContractMatch, AnalysisInput, PaginatedResponse, WorkerStatus

---

## Diagrama de Estados de un Contrato

```
                    +------------------+
                    | PENDING_ANALYSIS |
                    +--------+---------+
                             |
                    Worker obtiene tarea
                             |
                             v
                    +------------------+
                    |   PROCESSING     |
                    +--------+---------+
                             |
                   +---------+---------+
                   |                   |
            Analisis exitoso     Error/Fallo
                   |                   |
                   v                   v
            +-----------+      +------------+
            |  VIABLE   |      |  REJECTED  |
            +-----------+      +------------+
                   |
            (score >= umbral)
                   |
                   v
            Notificacion (opcional)

  Stuck task recovery: PROCESSING > 1 hora -> PENDING_ANALYSIS
```

---

## Tech Stack

| Capa | Tecnologia | Version |
|------|-----------|---------|
| Frontend | Next.js (App Router) | 15 |
| Frontend | React | 19 |
| Frontend | Tailwind CSS | 3.4 |
| Frontend | TanStack React Query | 5 |
| Frontend | NextAuth | 4 |
| Frontend | shadcn/ui | Radix-based |
| Backend API | Node.js / Express | 22 / 4 |
| Backend API | TypeScript | 5 |
| Backend API | Prisma ORM | Latest |
| Backend API | Zod (validation) | Latest |
| Backend API | Pino (logging) | Latest |
| Backend API | ws (WebSocket) | Latest |
| Worker | Python | 3.12 |
| Worker | CrewAI | Latest |
| Worker | Playwright | Latest |
| Worker | ChromaDB | Latest |
| Worker | marker-pdf (GPU) | Optional |
| Worker | pdfplumber | Fallback |
| Worker | langchain-text-splitters | RAG |
| LLM | Ollama (DeepSeek-R1 8B) | Default |
| LLM | Gemini 2.0 Flash | Alternativa |
| Database | PostgreSQL | 16 Alpine |
| Containerizacion | Docker Compose | 3.8 |
| Testing (API) | Vitest + Supertest | Latest |

---

## Instalacion y Configuracion

### Requisitos

- Node.js >= 22
- Python >= 3.12
- Docker + Docker Compose (opcional, para PostgreSQL)
- Ollama (opcional, para LLM local) con modelo `deepseek-r1:8b`
- Playwright Chromium (para descarga de PDFs)

### Variables de Entorno

Copiar `.env.example` a `.env` y configurar:

```env
# API
PORT=3001
NODE_ENV=development
API_KEY=dev-key-change-in-production
WORKER_API_KEY=worker-dev-key-change

# Base de Datos
DATABASE_URL=postgresql://pliegonaut:pliegonaut@localhost:5432/pliegonaut

# Worker
WORKER_ROOT=./apps/worker-python
PYTHON_EXEC=/path/to/python3
MAX_OCR_PAGES=50
POLL_INTERVAL=60

# LLM (ollama | gemini)
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:8b

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_API_KEY=dev-key-change-in-production
NEXTAUTH_SECRET=your-secret
NEXTAUTH_URL=http://localhost:3000

# SECOP / SODA (datos.gov.co)
SODA_API_URL=https://www.datos.gov.co/resource/p6dx-8zbt.json
SODA_API_TIMEOUT=120000
SECOP1_PROCESSES_URL=https://www.datos.gov.co/resource/f789-7hwg.json
SECOP_INTEGRADO_URL=https://www.datos.gov.co/resource/rpmr-utcd.json
# SOCRATA_APP_TOKEN=  # opcional, aumenta rate limit (Fase 1 del plan)
```

### Inicio Rapido (Desarrollo)

```bash
# 1. Iniciar PostgreSQL
docker compose up postgres -d

# 2. Instalar dependencias del monorepo
npm install

# 3. Generar Prisma Client y push schema
npx prisma generate
npx prisma db push

# 4. Iniciar API y Frontend
npm run dev
```

### Inicio con Docker Compose (Produccion)

```bash
docker compose up --build
```

Cuatro servicios:
- `postgres` - PostgreSQL 16 Alpine con healthcheck
- `api` - API Express en puerto 3001
- `web` - Next.js en puerto 3000
- `worker` - Python Worker conectado a API

### Registro de Empresa y Disparo de Escaneo

```bash
# Registrar empresa de ejemplo
./importar_technaut.sh

# Escaneo manual
curl -X POST http://localhost:3001/api/trigger-scanner \
  -H "Authorization: Bearer {API_KEY}"
```

---

## Estructura del Proyecto

```
secop-agent-platform/
  apps/
    api/                          # API REST (Node.js/Express/TypeScript)
      src/
        index.ts                  # Entry point: Express, CRON, WebSocket
        cron/stuckTasks.ts        # Monitor de tareas estancadas
        lib/
          errors.ts               # AppError class
          workerManager.ts        # EventEmitter de tareas
          wsServer.ts             # WebSocket server con auth/heartbeat
        middleware/
          auth.ts                 # Bearer token auth (tiempo constante)
          validate.ts             # Validacion Zod
        routes/
          companies.ts            # CRUD empresas
          contracts.ts            # Consulta contratos
          health.ts               # Health check
          scanner.ts              # Disparador de escaneo SECOP
          worker.ts               # Endpoints de polling y analisis
        services/
          sodaScanner.ts          # Integracion SODA API SECOP II
        __tests__/
          setup.ts                # Configuracion de tests
          auth.test.ts            # Tests de autenticacion
          health.test.ts          # Tests de health check
          routes.test.ts          # Tests de rutas completas
          validate.test.ts        # Tests de validacion Zod

    web/                          # Frontend (Next.js 15)
      src/
        app/
          layout.tsx              # Layout raiz
          page.tsx                # Dashboard con proteccion de sesion
          providers.tsx           # SessionProvider + QueryClientProvider
          globals.css             # Estilos globales Tailwind
          login/page.tsx          # Pagina de login
          api/auth/[...nextauth]/route.ts  # NextAuth handler
        components/
          dashboard/
            AnalyticsSummary.tsx  # Tarjetas de resumen (Total/Viables/etc)
            CompanySelector.tsx   # Selector de empresas
            ContractDetailsModal.tsx  # Modal con 3 tabs de analisis
            ContractsTable.tsx    # Tabla de contratos con estados
            DashboardClient.tsx   # Orquestador del dashboard
            DashboardHeader.tsx   # Header con avatar y logout
          ui/                     # shadcn/ui components
        lib/
          api.ts                  # Cliente HTTP (fetchCompanies, fetchContracts, triggerScanner)
          auth.ts                 # Configuracion NextAuth (CredentialsProvider)
          utils.ts                # cn(), formatCurrency()

    worker-python/                # Worker IA (Python)
      worker.py                   # Orquestador: WebSocket + polling + pipeline
      agentes_pliego.py           # Sistema de agentes CrewAI (Legal, Financial, Judge)
      descargador_secop.py        # Descarga de PDFs con Playwright
      ocr_marker.py               # OCR: marker-pdf (GPU) o pdfplumber
      rag_pliego.py               # RAG con ChromaDB para filtrado contextual
      requirements.txt            # Dependencias Python
      documentos/
        pdf_crudos/               # PDFs descargados
        markdown/                 # Texto extraido en Markdown

  packages/
    database/                     # Prisma Client singleton
      prisma/schema.prisma        # Schema: Company, ContractMatch
      index.ts                    # Cliente Prisma con caching global
    types/                        # Tipos TypeScript compartidos

  docker-compose.yml              # Infraestructura: postgres + api + web + worker
  Dockerfile                      # API Dockerfile (multi-stage)
  docker-entrypoint.sh            # Entrypoint: espera DB, prisma push, exec CMD
```

---

## Pipeline de IA Detallado

### Flujo de Procesamiento de una Tarea

```
Tarea entrante (ContractMatch):
  {
    id, secopId, entity, title, budget, urlPliego,
    company: { name, certifications, unspscCodes, liquidity, workingCapital }
  }

  FASE B1 - Descarga:
    DescargadorSECOP(urlPliego)
      -> Playwright navega a SECOP
      -> Busca "Documentos" -> "Pliego de Condiciones"
      -> Descarga PDF a ./documentos/pdf_crudos/
      -> Retorna ruta del PDF

  FASE B2 - Extraccion:
    OCRExtractor.extraer_markdown_de_pdf(pdf_path, max_pages=50)
      -> marker-pdf (GPU) o pdfplumber (fallback)
      -> Extrae texto pagina por pagina + tablas
      -> Guarda .md en ./documentos/markdown/
      -> Retorna texto completo en Markdown

  FASE C - Analisis IA:
    RAG (opcional):
      ChromaDB filtra chunks relevantes para legal y financiero

    CrewAI.crear_equipo_analisis(pliego_markdown, perfil_empresa):
      Task 1: Analista Legal
        -> Busca requisitos habilitantes, polizas, experiencia
        -> Output: ReporteLegal (Pydantic)

      Task 2: Analista Financiero
        -> Evalua liquidez, capital de trabajo, anticipos
        -> Output: ReporteFinanciero (Pydantic)

      Task 3: Juez Final
        -> Cruza ambos reportes
        -> Output: VeredictoFinal (Pydantic)

    Validacion:
      validar_veredicto(veredicto):
        - viable debe ser bool
        - score_viabilidad entre 0-100
        - resumen_ejecutivo >= 10 chars
        - consistencia viable/causales_rechazo

    Envio:
      PATCH /api/worker/tasks/{id}/analysis
        status: VIABLE | REJECTED
        viabilityScore: 0-100
        reportLegal, reportFinancial, reportFinal
```

### Configuracion de LLM

```python
# agentes_pliego.py
# Provider: ollama (default) o gemini
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama")

if USE_LOCAL_LLM:
    llm = LLM(
        model=f"ollama/{OLLAMA_MODEL}",  # deepseek-r1:8b
        base_url=OLLAMA_BASE_URL,         # http://localhost:11434
        temperature=0.3,
    )
else:
    llm = LLM(
        model=GEMINI_MODEL,               # gemini/gemini-2.0-flash
        api_key=GEMINI_API_KEY,
        temperature=0.3,
    )
```

### RAG Pipeline

```python
# rag_pliego.py
# Chunking: 1500 chars, overlap 300
# ChromaDB in-memory con all-MiniLM-L6-v2
# Queries:
#   Legal: "requisitos habilitantes experiencia certificaciones ISO 9001 RUP..."
#   Financial: "capacidad financiera capital de trabajo indice de liquidez..."
# Top-K: 15 chunks legales, 10 chunks financieros
```

---

## Testing

```bash
# Tests de la API
cd apps/api
npx vitest run

# Tests del frontend
cd apps/web
npx vitest run
```

Cobertura:
- Autenticacion: tokens validos/invalidos, admin vs worker, cross-token rejection
- Validacion Zod: datos de empresa validos/invalidos, datos de analisis, valores default
- Rutas: CRUD empresas, listado de contratos, workers tasks, envio de analisis, escaneo, NIT duplicado, conflictos de estado, 404
- Health check: response status ok, uptime, timestamp

---

## Monitoreo y Operaciones

### Health Checks
- API: `GET /api/health` - status, uptime, timestamp
- Worker: Servidor HTTP interno en puerto aleatorio
- Docker: Healthcheck de PostgreSQL con `pg_isready`

### Logging
- API: Pino con formato estructurado (pretty-print en desarrollo)
- Worker: Logs a stdout con prefijos `[FASE B1]`, `[FASE C]`, `[WS]`, `[VALIDACION]`

### Recuperacion Automatica
- Tareas estancadas en `PROCESSING` por > 1 hora se reinician automaticamente a `PENDING_ANALYSIS`
- Worker reconexion automatica a WebSocket con fallback a HTTP polling
- SODA Scanner con retry exponencial y batch processing (max 3 empresas concurrentes)

---

## Sobre el Proyecto

PliegoNaut esta disenado para reducir el tiempo de analisis de licitaciones publicas en Colombia de horas a minutos, permitiendo a empresas pequenas y medianas competir en el SECOP II con informacion estructurada y basada en datos.

**Casos de uso:**
- Empresas que participan en licitaciones publicas y necesitan filtrar rapidamente oportunidades viables
- Departamentos juridicos que requieren un primer filtro automatico de requisitos habilitantes
- Areas financieras que evaluan capacidad economica y riesgo de contratos publicos

**Limitaciones:**
- El sistema depende de la calidad y oportunidad de los datos publicados en SECOP
- **Retraso de ~24h**: los datasets publicos de datos.gov.co (Socrata) se actualizan una vez al dia via ETL de Colombia Compra Eficiente. Los procesos publicados "hoy" aparecen en la API "manana". Esto afecta a los procesos de plazo corto (mínima/menor cuantía: 1-2 dias) pero es tolerable para licitaciones públicas (10+ dias legales). Ver `docs/PLAN_TIEMPO_REAL.md` para el roadmap de mitigacion.
- **SECOP I desactualizado**: el dataset `rpmr-utcd` mantiene procesos en estado "Convocado" que en realidad ya fueron adjudicados. Se mitiga con umbral de antiguedad (540 dias para SECOP I, 90 dias para SECOP II) y uso del dataset `f789-7hwg` (con `fecha_de_cargue_en_el_secop` real) como fuente principal de SECOP I.
- **No existe API publica en tiempo real de SECOP**: la plataforma transaccional `community.secop.gov.co` (VORTAL) es tiempo real pero no expone API publica (solo HTML+JS con ReCaptcha). Ver `docs/PLAN_TIEMPO_REAL.md`.
- **Municipios pequeños**: algunos municipios (como Santa María, Huila) publican pocos procesos anuales en SECOP II (~16 en 2026); la alcaldía publica en SECOP I. No es un bug, es la realidad del municipio.
- El analisis IA es un primer filtro; siempre se recomienda revision legal y financiera profesional
- marker-pdf requiere GPU con CUDA para rendimiento optimo (fallback a pdfplumber disponible)

---

## Roadmap

El proyecto evoluciona en 3 fases para mitigar el retraso de la fuente de datos. El detalle completo esta en `docs/PLAN_TIEMPO_REAL.md`:

1. **Fase 1 (bajo riesgo):** mejoras en datos.gov.co — pulls incrementales cada hora, combinacion de 3 datasets, App Token Socrata.
2. **Fase 2 (alto riesgo):** scraper de VORTAL (`community.secop.gov.co`) para deteccion en tiempo real + descarga automatica de pliegos, con fallback a datos.gov.co.
3. **Fase 3 (largo plazo):** acuerdo comercial con CCE/VORTAL para acceso a API transaccional oficial.

## Documentacion adicional

- `docs/PLAN_TIEMPO_REAL.md` — Plan detallado del roadmap híbrido (datos.gov.co + scraping VORTAL + acuerdo CCE), dividido en fases, sub-fases, verificaciones y areas de mejora.
