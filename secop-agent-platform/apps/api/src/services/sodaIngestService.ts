import axios from 'axios';
import axiosRetry from 'axios-retry';
import { prisma } from '@pliegonaut/database';

// ===== Fases 1.1 + 1.2 del PLAN_TIEMPO_REAL.md =====
// Ingestión incremental multi-fuente de SECOP con cursor de marca de agua por dataset:
//   - p6dx-8zbt (SECOP II Procesos)   -> source 'secop_ii'           (fuente primaria)
//   - f789-7hwg (SECOP I Procesos)    -> source 'secop_i_procesos'    (alcaldías, fecha de cargue real)
//   - rpmr-utcd (SECOP Integrado)     -> source 'secop_i_integrado'   (fallback convocados, solo Convocado)
//   - jbjy-vk9h (SECOP II Contratos)  -> enriquecimiento de adjudicaciones (proveedor + valor)
// Cada dataset lleva su propia marca de agua en IngestLog. Dedup estricto por id_del_proceso
// manteniendo la fuente más fresca (secop_ii > secop_i_procesos > secop_i_integrado).
//
// NOTA rpmr-utcd: los procesos abiertos (Convocado) no exponen una fecha utilizable como
// watermark (solo fecha de contrato firmado). Por eso esta fuente se ingesta con un $where
// fijo por estado ('CONVOCADO') en lugar de por fecha, y el dedup por id_del_proceso evita
// duplicados entre ejecuciones. Sigue además activo como fallback en la búsqueda manual
// (Query 3c de /api/search).

const SODA_API_URL = process.env.SODA_API_URL || 'https://www.datos.gov.co/resource/p6dx-8zbt.json';
const SECOP1_PROCESSES_URL = process.env.SECOP1_PROCESSES_URL || 'https://www.datos.gov.co/resource/f789-7hwg.json';
const SECOP_INTEGRADO_URL = process.env.SECOP_INTEGRADO_URL || 'https://www.datos.gov.co/resource/rpmr-utcd.json';
const SECOP2_CONTRACTS_URL = process.env.SECOP2_CONTRACTS_URL || 'https://www.datos.gov.co/resource/jbjy-vk9h.json';

const SODA_TIMEOUT = parseInt(process.env.SODA_API_TIMEOUT || '120000', 10);
const SODA_APP_TOKEN = process.env.SOCRATA_APP_TOKEN || '';

// Socrata permite máximo 1000 registros por request ($limit).
const PAGE_SIZE = parseInt(process.env.INGEST_PAGE_SIZE || '1000', 10);
const MAX_PAGES = parseInt(process.env.INGEST_MAX_PAGES || '10', 10);

// En el primer arranque (sin IngestLog) se ingesta hacia atrás N días.
const BOOTSTRAP_LOOKBACK_DAYS = parseInt(process.env.INGEST_BOOTSTRAP_DAYS || '7', 10);

const INGEST_SECOP1_ENABLED = process.env.INGEST_SECOP1_ENABLED !== 'false';
const INGEST_SECOP_INTEGRADO_ENABLED = process.env.INGEST_SECOP_INTEGRADO_ENABLED !== 'false';
const INGEST_CONTRACTS_ENABLED = process.env.INGEST_CONTRACTS_ENABLED !== 'false';

const ACTIVE_STATUSES = ['Convocado', 'Presentación de oferta', 'Abierto', 'Publicado'];

const sodaClient = axios.create({
  timeout: SODA_TIMEOUT,
  headers: SODA_APP_TOKEN ? { 'X-App-Token': SODA_APP_TOKEN } : {},
});

axiosRetry(sodaClient, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 429;
  },
});

type Logger = { info: (msg: string, ...args: any[]) => void; error: (msg: string, ...args: any[]) => void };

type NormalizedProcess = {
  id_del_proceso: string;
  source: string; // secop_ii | secop_i_procesos | secop_i_integrado
  priority: number; // menor = más fresca (para dedup cross-fuente)
  entidad: string;
  departamento_entidad: string;
  ciudad_entidad: string;
  descripcion: string;
  estado_del_procedimiento: string;
  fase: string;
  estado_de_apertura_del_proceso: string;
  precio_base: number;
  urlproceso: string;
  fecha_de_publicacion_del: string | null;
  fecha_de_recepcion_de: string | null;
  codigo_principal_de_categoria?: string;
  id_del_portafolio?: string;
  duracion?: string;
  unidad_de_duracion?: string;
  modalidad_de_contratacion?: string;
  nombre_de_la_unidad_de?: string;
  raw: any; // registro crudo para rawSodaData
};

type ProcessSource = {
  id: string;
  url: string;
  watermarkField: string;
  source: string;
  priority: number;
  normalize: (raw: any) => NormalizedProcess | null;
  whereOverride?: string; // $where fijo (p. ej. por estado) cuando no hay fecha utilizable como watermark
  orderField?: string;    // campo de orden cuando difiere del watermarkField
};

function escapeSoql(value: string): string {
  return value.replace(/'/g, "''");
}

function parseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

// Socrata devuelve timestamps UTC SIN sufijo de zona (ej: '2026-08-02T00:00:00.000').
// `new Date()` los interpretaría como hora local y rompería la comparación de la
// marca de agua (lag de zona). Para la marca de agua se interpreta como UTC puro.
function parseWatermarkDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const hasZone = /Z$|[+-]\d{2}:?\d{2}$/.test(dateStr);
  const d = new Date(hasZone ? dateStr : `${dateStr}Z`);
  return isNaN(d.getTime()) ? null : d;
}

function formatSoqlDate(d: Date): string {
  // Socrata acepta literales ISO-8601 en UTC (sin 'Z')
  return d.toISOString().replace('Z', '');
}

export function datasetIdFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const seg = path.split('/').pop() || '';
    return seg.replace(/\.json$/, '');
  } catch {
    return 'unknown';
  }
}

// ===== Normalizadores por fuente =====

function normalizeSecopII(raw: any): NormalizedProcess {
  return {
    id_del_proceso: raw.id_del_proceso,
    source: 'secop_ii',
    priority: 1,
    entidad: raw.entidad || 'Sin entidad',
    departamento_entidad: raw.departamento_entidad || '',
    ciudad_entidad: raw.ciudad_entidad || '',
    descripcion: raw.descripci_n_del_procedimiento || 'Sin descripción',
    estado_del_procedimiento: raw.estado_del_procedimiento || '',
    fase: raw.fase || '',
    estado_de_apertura_del_proceso: raw.estado_de_apertura_del_proceso || '',
    precio_base: parseFloat(raw.precio_base) || 0,
    urlproceso: raw.urlproceso?.url || raw.url_del_proceso || '',
    fecha_de_publicacion_del: raw.fecha_de_publicacion_del || null,
    fecha_de_recepcion_de:
      raw.fecha_de_recepcion_de ||
      raw.fecha_de_presentacion_de_la_oferta ||
      raw.fecha_fin_procedimiento ||
      raw.fecha_limite_presentacion ||
      null,
    codigo_principal_de_categoria: raw.codigo_principal_de_categoria || '',
    id_del_portafolio: raw.id_del_portafolio || undefined,
    duracion: raw.duracion || '',
    unidad_de_duracion: raw.unidad_de_duracion || '',
    modalidad_de_contratacion: raw.modalidad_de_contratacion || '',
    nombre_de_la_unidad_de: raw.nombre_de_la_unidad_de || '',
    raw,
  };
}

// SECOP I Procesos (f789-7hwg): solo procesos abiertos (Convocado). No expone UNSPSC.
function normalizeSecopI(raw: any): NormalizedProcess | null {
  const estado = (raw.estado_del_proceso || '').toUpperCase();
  if (estado !== 'CONVOCADO') return null;
  return {
    id_del_proceso: raw.numero_de_proceso || raw.numero_de_contrato || '',
    source: 'secop_i_procesos',
    priority: 2,
    entidad: raw.nombre_entidad || 'Sin entidad',
    departamento_entidad: raw.departamento_entidad || '',
    ciudad_entidad: raw.municipio_entidad || '',
    descripcion: raw.detalle_del_objeto_a_contratar || raw.objeto_a_contratar || 'Sin descripción',
    estado_del_procedimiento: raw.estado_del_proceso || 'Convocado',
    fase: 'Presentación de oferta',
    estado_de_apertura_del_proceso: 'Abierto',
    precio_base: parseFloat(raw.cuantia_proceso) || 0,
    urlproceso: raw.ruta_proceso_en_secop_i?.url || '',
    fecha_de_publicacion_del: raw.fecha_de_cargue_en_el_secop || null,
    fecha_de_recepcion_de: null,
    codigo_principal_de_categoria: '',
    modalidad_de_contratacion: raw.modalidad_de_contratacion || '',
    raw,
  };
}

// SECOP Integrado (rpmr-utcd): fallback para convocados de alcaldías no capturados por
// f789-7hwg. No expone fecha de recepción de ofertas ni UNSPSC. Como los procesos abiertos
// carecen de fecha utilizable como watermark, esta fuente se ingesta con un $where fijo por
// estado (CONVOCADO) en lugar de por fecha (ver whereOverride en buildSources).
function normalizeSecopIntegrado(raw: any): NormalizedProcess | null {
  const estado = (raw.estado_del_proceso || '').toUpperCase();
  if (estado !== 'CONVOCADO') return null;

  let pubDate: string | null = raw.fecha_de_firma_del_contrato || null;
  if (!pubDate && raw.url_contrato) {
    const match = String(raw.url_contrato).match(/numConstancia=(\d{2})-\d{1,2}-(\d+)/);
    if (match) {
      const year = 2000 + parseInt(match[1], 10);
      pubDate = `${year}-07-01T00:00:00.000`;
    }
  }

  return {
    id_del_proceso: raw.numero_de_proceso || raw.numero_del_contrato || '',
    source: 'secop_i_integrado',
    priority: 3,
    entidad: raw.nombre_de_la_entidad || 'Sin entidad',
    departamento_entidad: raw.departamento_entidad || '',
    ciudad_entidad: raw.municipio_entidad || '',
    descripcion: raw.objeto_del_proceso || raw.objeto_a_contratar || 'Sin descripción',
    estado_del_procedimiento: raw.estado_del_proceso || 'Convocado',
    fase: 'Presentación de oferta',
    estado_de_apertura_del_proceso: 'Abierto',
    precio_base: parseFloat(raw.valor_contrato) || 0,
    urlproceso: raw.url_contrato || '',
    fecha_de_publicacion_del: pubDate,
    fecha_de_recepcion_de: null,
    codigo_principal_de_categoria: '',
    modalidad_de_contratacion: raw.modalidad_de_contrataci_n || '',
    raw,
  };
}

// ===== Helpers de match y persistencia =====

export function computeMatchScore(company: any, contract: any): number {
  let score = 0;
  const companyCodes = company.unspscCodes?.split(',').map((c: string) => c.trim()) || [];
  const contractCategory = contract.codigo_principal_de_categoria || '';
  if (companyCodes.some((c: string) => contractCategory.includes(c))) score += 30;

  const companyRegions = company.regions?.split(',').map((r: string) => r.trim()) || [];
  if (companyRegions.includes(contract.departamento_entidad)) score += 20;

  if (contract.precio_base) {
    const budget = typeof contract.precio_base === 'number' ? contract.precio_base : parseFloat(contract.precio_base);
    if (budget >= company.minBudget && budget <= company.maxBudget) score += 20;
  }

  if (ACTIVE_STATUSES.includes(contract.estado_del_procedimiento)) score += 10;

  if (contract.fecha_de_publicacion_del) {
    const daysSincePub = (Date.now() - new Date(contract.fecha_de_publicacion_del).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSincePub < 7) score += 10;
    else if (daysSincePub < 30) score += 5;
  }

  return Math.min(score, 100);
}

function companyMatchesContract(company: any, contract: NormalizedProcess): boolean {
  const companyCodes = company.unspscCodes
    ? company.unspscCodes.split(',').map((c: string) => c.trim()).filter(Boolean)
    : [];
  if (companyCodes.length > 0) {
    const cat = contract.codigo_principal_de_categoria || '';
    // SECOP I no expone código UNSPSC: sin categoría no se puede filtrar por código.
    if (cat && !companyCodes.some((c: string) => cat.includes(c))) return false;
  }

  const companyRegions = company.regions
    ? company.regions.split(',').map((r: string) => r.trim()).filter(Boolean)
    : [];
  if (companyRegions.length > 0 && !companyRegions.includes(contract.departamento_entidad)) return false;

  if (contract.precio_base) {
    if (contract.precio_base < company.minBudget || contract.precio_base > company.maxBudget) return false;
  }

  return ACTIVE_STATUSES.includes(contract.estado_del_procedimiento);
}

function contractToInsert(
  company: any,
  contract: NormalizedProcess,
  adjudicaciones: Map<string, { proveedor: string; valor: number }>
): any {
  const enrich = contract.id_del_portafolio ? adjudicaciones.get(contract.id_del_portafolio) : undefined;
  return {
    companyId: company.id,
    secopId: contract.id_del_proceso,
    entity: contract.entidad,
    title: contract.descripcion,
    budget: contract.precio_base,
    urlPliego: contract.urlproceso,
    status: "PENDING_ANALYSIS",
    phase: contract.fase || '',
    contractStatus: contract.estado_del_procedimiento || '',
    department: contract.departamento_entidad || '',
    region: contract.ciudad_entidad || '',
    categoryCode: contract.codigo_principal_de_categoria || '',
    categoryName: contract.codigo_principal_de_categoria || '',
    contactName: contract.nombre_de_la_unidad_de || '',
    estimatedDuration: `${contract.duracion || ''} ${contract.unidad_de_duracion || ''}`.trim(),
    publishedAt: parseDate(contract.fecha_de_publicacion_del),
    closingDate: parseDate(contract.fecha_de_recepcion_de),
    presentationDeadline: parseDate(contract.fecha_de_recepcion_de),
    matchScore: computeMatchScore(company, contract),
    source: contract.source,
    awarded: !!enrich,
    awardedProveedor: enrich?.proveedor || '',
    valorAdjudicado: enrich?.valor ?? null,
    rawSodaData: JSON.stringify(contract.raw),
  };
}

async function updateIngestLog(datasetId: string, opts: {
  lastSeenPub?: Date;
  recordsFetched: number;
  status: 'OK' | 'ERROR';
  errors?: string;
}) {
  const { lastSeenPub, recordsFetched, status, errors = '' } = opts;
  await prisma.ingestLog.upsert({
    where: { datasetId },
    create: {
      datasetId,
      lastSeenPub: lastSeenPub ?? new Date(),
      recordsFetched,
      status,
      errors,
    },
    update: {
      ...(lastSeenPub ? { lastSeenPub } : {}),
      recordsFetched,
      status,
      errors,
      lastIngestAt: new Date(),
    },
  });
}

// ===== Fetch genérico de una fuente con marca de agua =====

async function fetchSourceRecords(
  source: ProcessSource,
  watermark: Date,
  log: Logger
): Promise<{ records: NormalizedProcess[]; newWatermark: Date; fetchedPages: number }> {
  const records: NormalizedProcess[] = [];
  let offset = 0;
  let newWatermark = watermark;
  let minSeen: Date | null = null;
  let fetchedPages = 0;
  let stoppedByPageLimit = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const where = source.whereOverride || `${source.watermarkField} >= '${escapeSoql(formatSoqlDate(watermark))}'`;
    const params: Record<string, string | number> = {
      $where: where,
      $limit: PAGE_SIZE,
      $offset: offset,
    };
    if (!source.whereOverride) {
      params.$order = `${source.watermarkField} DESC`;
    } else if (source.orderField) {
      params.$order = `${source.orderField} DESC`;
    }
    const response = await sodaClient.get(source.url, { params });
    const rawRecords = response.data || [];
    if (rawRecords.length === 0) break;
    fetchedPages++;

    for (const r of rawRecords) {
      const d = parseWatermarkDate(r[source.watermarkField]);
      if (d) {
        if (d.getTime() > newWatermark.getTime()) newWatermark = d;
        if (!minSeen || d.getTime() < minSeen.getTime()) minSeen = d;
      }
      const n = source.normalize(r);
      if (n) records.push(n);
    }
    log.info(`[INGEST] Dataset ${source.id}: página ${fetchedPages} con ${rawRecords.length} registros brutos`);

    if (rawRecords.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (page === MAX_PAGES - 1) stoppedByPageLimit = true;
  }

  // Si se cortó por el límite de páginas, avanzar al MÍNIMO visto para drenar el resto
  // en la siguiente ejecución (dedup por id_del_proceso evita duplicados).
  if (stoppedByPageLimit && minSeen && minSeen.getTime() < newWatermark.getTime()) {
    newWatermark = minSeen;
    log.info(`[INGEST] Dataset ${source.id}: ventana truncada por MAX_PAGES, watermark = mínimo visto (${minSeen.toISOString()})`);
  }

  return { records, newWatermark, fetchedPages };
}

// ===== Enriquecimiento de adjudicaciones (jbjy-vk9h) =====

async function fetchContractsEnrichment(log: Logger): Promise<Map<string, { proveedor: string; valor: number }>> {
  const map = new Map<string, { proveedor: string; valor: number }>();
  if (!INGEST_CONTRACTS_ENABLED) return map;

  const datasetId = datasetIdFromUrl(SECOP2_CONTRACTS_URL);
  const row = await prisma.ingestLog.findUnique({ where: { datasetId } });
  const watermark = row?.lastSeenPub ?? new Date(Date.now() - BOOTSTRAP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  let offset = 0;
  let total = 0;
  let newWatermark = watermark;

  for (let page = 0; page < MAX_PAGES; page++) {
    const where = `fecha_de_firma >= '${escapeSoql(formatSoqlDate(watermark))}'`;
    const response = await sodaClient.get(SECOP2_CONTRACTS_URL, {
      params: {
        $where: where,
        $order: 'fecha_de_firma DESC',
        $select: 'proceso_de_compra,proveedor_adjudicado,valor_del_contrato',
        $limit: PAGE_SIZE,
        $offset: offset,
      },
    });
    const rows = response.data || [];
    if (rows.length === 0) break;

    for (const r of rows) {
      const d = parseWatermarkDate(r.fecha_de_firma);
      if (d && d.getTime() > newWatermark.getTime()) newWatermark = d;
      if (r.proceso_de_compra) {
        map.set(r.proceso_de_compra, {
          proveedor: r.proveedor_adjudicado || '',
          valor: parseFloat(r.valor_del_contrato) || 0,
        });
      }
    }
    total += rows.length;
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  await updateIngestLog(datasetId, { lastSeenPub: newWatermark, recordsFetched: total, status: 'OK' });
  log.info(`[INGEST] Dataset ${datasetId}: ${total} contratos, watermark=${newWatermark.toISOString()}`);
  return map;
}

// ===== Fuentes habilitadas =====

function buildSources(): ProcessSource[] {
  const sources: ProcessSource[] = [
    {
      id: datasetIdFromUrl(SODA_API_URL),
      url: SODA_API_URL,
      watermarkField: 'fecha_de_ultima_publicaci',
      source: 'secop_ii',
      priority: 1,
      normalize: normalizeSecopII,
    },
  ];
  if (INGEST_SECOP1_ENABLED) {
    sources.push({
      id: datasetIdFromUrl(SECOP1_PROCESSES_URL),
      url: SECOP1_PROCESSES_URL,
      watermarkField: 'fecha_de_cargue_en_el_secop',
      source: 'secop_i_procesos',
      priority: 2,
      normalize: normalizeSecopI,
    });
  }
  if (INGEST_SECOP_INTEGRADO_ENABLED) {
    sources.push({
      id: datasetIdFromUrl(SECOP_INTEGRADO_URL),
      url: SECOP_INTEGRADO_URL,
      watermarkField: 'fecha_de_firma_del_contrato',
      whereOverride: "upper(estado_del_proceso) = 'CONVOCADO'",
      source: 'secop_i_integrado',
      priority: 3,
      normalize: normalizeSecopIntegrado,
    });
  }
  return sources;
}

// ===== Orquestador =====

export async function runIncrementalSodaIngest(logger?: Logger): Promise<{
  records: number;
  nuevos: number;
  watermark: Date;
}> {
  const log = logger || { info: console.log, error: console.error };
  const sources = buildSources();
  const all: NormalizedProcess[] = [];
  let maxWatermark: Date | null = null;
  let hadError = false;
  let firstError: Error | null = null;

  // 1. Pull incremental por fuente (cada una con su watermark)
  for (const source of sources) {
    const row = await prisma.ingestLog.findUnique({ where: { datasetId: source.id } });
    const watermark = row?.lastSeenPub ?? new Date(Date.now() - BOOTSTRAP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    log.info(
      `[INGEST] Dataset ${source.id}: watermark=${watermark.toISOString()} ` +
      `(${row ? 'persistida' : `bootstrap ${BOOTSTRAP_LOOKBACK_DAYS}d`})`
    );

    try {
      const res = await fetchSourceRecords(source, watermark, log);
      all.push(...res.records);
      if (!maxWatermark || res.newWatermark.getTime() > maxWatermark.getTime()) maxWatermark = res.newWatermark;
      await updateIngestLog(source.id, { lastSeenPub: res.newWatermark, recordsFetched: res.records.length, status: 'OK' });
      if (res.records.length === 0) {
        log.info(`[INGEST] Dataset ${source.id}: sin cambios desde la última ingesta`);
      }
    } catch (err: any) {
      hadError = true;
      firstError = firstError || err;
      log.error(`[INGEST] Dataset ${source.id}: error: ${err.message}`);
      try {
        await updateIngestLog(source.id, { recordsFetched: 0, status: 'ERROR', errors: String(err?.message || err) });
      } catch (logErr) {
        log.error(`[INGEST] No se pudo registrar el error en IngestLog: ${logErr}`);
      }
    }
  }

  // 2. Dedup cross-fuente por id_del_proceso (prioridad: secop_ii > secop_i_procesos)
  const byId = new Map<string, NormalizedProcess>();
  for (const r of all) {
    if (!r.id_del_proceso) continue;
    const existing = byId.get(r.id_del_proceso);
    if (!existing || r.priority < existing.priority) byId.set(r.id_del_proceso, r);
  }
  const unique = [...byId.values()];
  log.info(`[INGEST] Total: ${all.length} brutos, ${unique.length} únicos (dedup cross-fuente)`);

  // 3. Enriquecimiento de adjudicaciones (best-effort, no rompe el flujo)
  let adjudicaciones = new Map<string, { proveedor: string; valor: number }>();
  try {
    adjudicaciones = await fetchContractsEnrichment(log);
  } catch (err: any) {
    log.error(`[INGEST] Enriquecimiento de contratos falló (se continúa sin adjudicaciones): ${err.message}`);
  }

  // 4. Match por empresa y persistencia en ContractMatch
  const companies = await prisma.company.findMany({ orderBy: { createdAt: 'desc' } });
  let nuevos = 0;

  for (const company of companies) {
    const existing = await prisma.contractMatch.findMany({
      where: { companyId: company.id },
      select: { secopId: true },
    });
    const existingSet = new Set(existing.map((e) => e.secopId));

    const candidates = unique.filter(
      (c) => companyMatchesContract(company, c) && !existingSet.has(c.id_del_proceso)
    );
    if (candidates.length === 0) continue;

    const batchSize = 10;
    for (let i = 0; i < candidates.length; i += batchSize) {
      await prisma.contractMatch.createMany({
        data: candidates.slice(i, i + batchSize).map((c) => contractToInsert(company, c, adjudicaciones)),
      });
    }
    nuevos += candidates.length;
    log.info(`[INGEST] ${company.name}: ${candidates.length} nuevos matches`);
  }

  const watermark = maxWatermark ?? new Date();

  if (hadError && unique.length === 0) {
    throw firstError || new Error('Todas las fuentes de ingestión fallaron');
  }

  log.info(`[INGEST] Completado: ${unique.length} registros, ${nuevos} nuevos para empresas`);
  return { records: unique.length, nuevos, watermark };
}
