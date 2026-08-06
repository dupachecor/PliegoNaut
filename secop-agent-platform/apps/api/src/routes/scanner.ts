import { Router } from 'express';
import { runDailySecopScanner } from '../services/sodaScanner';
import { broadcastNewTask } from '../lib/wsServer';
import { requireApiKey } from '../middleware/auth';
import { validate, searchSchema } from '../middleware/validate';
import { TtlCache } from '../lib/ttlCache';
import { prisma } from '@pliegonaut/database';
import type { Logger } from 'pino';

const router = Router();

// Caché en memoria de 15 min para la búsqueda manual (reduce carga en SODA).
// Fase 1.5 del PLAN_TIEMPO_REAL.md. Sin DB; expiración lazy + evicción por tamaño.
export const searchCache = new TtlCache<string, any>(
  parseInt(process.env.SEARCH_CACHE_TTL_MS || `${15 * 60 * 1000}`, 10),
  parseInt(process.env.SEARCH_CACHE_MAX || '200', 10),
);

export function clearSearchCache() {
  searchCache.clear();
}

// Fase 1.5: sirve la búsqueda manual desde la DB enriquecida (ContractMatch ingerido por el
// cron) cuando SEARCH_USE_DB=true. Si no hay resultados o falla, el route cae a SODA en vivo.
function isSearchUseDb(): boolean {
  return process.env.SEARCH_USE_DB === 'true';
}

function normalize(text: string): string {
  if (!text) return '';
  return text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeSoql(val: string): string {
  return val.replace(/'/g, "''");
}

async function searchEnrichedDb(body: any, log: Logger): Promise<{ results: any[]; total: number }> {
  const { unspscCodes, minBudget, maxBudget, department, municipio, status, searchText } = body;

  const activeStatuses = ['Convocado', 'Presentación de oferta', 'Abierto', 'Publicado'];
  const where: any = {
    // contractStatus guarda el estado del procedimiento en SECOP (no el estado de análisis)
    contractStatus: { in: status && status.length > 0 ? status : activeStatuses },
  };

  if (minBudget !== undefined) where.budget = { gte: minBudget };
  if (maxBudget !== undefined) where.budget = { ...where.budget, lte: maxBudget };
  if (department) where.department = { contains: department };
  if (municipio) where.region = { contains: municipio };

  const orClauses: any[] = [];
  if (searchText) {
    orClauses.push({ title: { contains: searchText } }, { entity: { contains: searchText } });
  }
  if (unspscCodes && unspscCodes.length > 0) {
    orClauses.push(...unspscCodes.map((code: string) => ({ categoryCode: { contains: code } })));
  }
  if (orClauses.length > 0) where.OR = orClauses;

  const rows = await prisma.contractMatch.findMany({
    where,
    orderBy: [{ publishedAt: 'desc' }, { matchScore: 'desc' }],
    take: 200,
  });

  // Dedup por secopId: un proceso puede existir para varias empresas
  const byId = new Map<string, any>();
  for (const r of rows) {
    if (!r.secopId || byId.has(r.secopId)) continue;
    byId.set(r.secopId, r);
  }

  const now = new Date();
  let results = [...byId.values()].map((r: any) => {
    const source = r.source || 'secop_ii';
    return {
      secopId: r.secopId,
      entity: r.entity,
      title: r.title,
      budget: r.budget || 0,
      urlPliego: r.urlPliego,
      phase: r.phase || '',
      status: r.contractStatus || r.status || '',
      department: r.department || '',
      municipio: r.region || '',
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      closingDate: r.closingDate ? r.closingDate.toISOString() : null,
      isOpen: (r.contractStatus || '') === 'Abierto' || false,
      awarded: r.awarded || false,
      isExpired: computeDbExpired(r, source, now),
      category: r.categoryCode || '',
      duration: r.estimatedDuration || '',
      modality: '',
      source,
    };
  });

  // Filtro estricto de municipio (elimina falsos positivos de entidad/descripción)
  if (municipio) {
    const munNorm = normalize(municipio);
    results = results.filter((r: any) => {
      const regionNorm = normalize(r.municipio || '');
      const entityNorm = normalize(r.entity || '');
      const regionReal = (r.municipio || '').toLowerCase();
      const noDefinido = !r.municipio || /no definido|sin informaci/i.test(r.municipio || '');
      const matchesRegion = regionNorm.includes(munNorm) || regionReal.includes(municipio.toLowerCase());
      const matchesEntity = entityNorm.includes(munNorm);
      if (!matchesRegion && !matchesEntity) return false;
      if (!noDefinido && !matchesRegion && matchesEntity) return false;
      return true;
    });
  }

  // Sort estricto por fecha de publicación DESC (sin fecha al final)
  results.sort((a: any, b: any) => {
    const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB - dateA;
  });

  return { results: results.slice(0, 1000), total: results.length };
}

function computeDbExpired(r: any, source: string, now: Date): boolean {
  const isSecop1 = source === 'secop_i_procesos' || source === 'secop_i_integrado' || source === 'secop_integrado';
  if (r.closingDate && new Date(r.closingDate).getTime() < now.getTime()) return true;
  const activeStates = ['Publicado', 'Convocado', 'Abierto', 'Presentación de oferta'];
  if (!activeStates.includes(r.contractStatus || '')) return true;
  if (r.publishedAt) {
    const MAX_AGE_MS = isSecop1 ? 540 * 24 * 60 * 60 * 1000 : 90 * 24 * 60 * 60 * 1000;
    if (now.getTime() - new Date(r.publishedAt).getTime() > MAX_AGE_MS) return true;
  }
  return false;
}

router.post('/api/trigger-scanner', requireApiKey, (req, res) => {
  const logger = req.app.locals.logger as Logger;
  logger.info('[SCANNER] Trigger manual');

  runDailySecopScanner({
    info: (msg: string, ...args: any[]) => logger.info({ source: 'soda' }, msg, ...args),
    error: (msg: string, ...args: any[]) => logger.error({ source: 'soda' }, msg, ...args),
  }).then(() => {
    broadcastNewTask();
  }).catch((err) => {
    logger.error({ err }, '[SCANNER] Error en trigger manual');
  });

  res.json({ message: 'Escaneo SODA iniciado en background' });
});

// Manual search - ad-hoc SECOP search without company filter
router.post('/api/search', requireApiKey, validate(searchSchema), async (req, res) => {
  const logger = (req.app.locals.logger as Logger) || console;
  const { unspscCodes, minBudget, maxBudget, department, municipio, status, searchText } = req.body;

  // Clave estable para la caché (body normalizado)
  const cacheKey = JSON.stringify([
    unspscCodes ?? [],
    minBudget ?? null,
    maxBudget ?? null,
    department ?? '',
    municipio ?? '',
    status ?? [],
    searchText ?? '',
  ]);
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  // Fase 1.5: búsqueda desde la DB enriquecida (ContractMatch ingerido) si está activa.
  // Si no hay resultados o falla, se cae a SODA en vivo (fallback).
  if (isSearchUseDb()) {
    try {
      const dbPayload = await searchEnrichedDb(req.body, logger);
      if (dbPayload.results.length > 0) {
        logger.info(`[SEARCH] ${dbPayload.total} resultados desde DB enriquecida`);
        searchCache.set(cacheKey, dbPayload);
        return res.json(dbPayload);
      }
      logger.info('[SEARCH] DB enriquecida sin resultados, fallback a SODA');
    } catch (err: any) {
      logger.error(`[SEARCH] DB search falló (${err?.message}), fallback a SODA`);
    }
  }

  const axios = (await import('axios')).default;
  const SODA_API_URL = process.env.SODA_API_URL || 'https://www.datos.gov.co/resource/p6dx-8zbt.json';
  const SODA_APP_TOKEN = process.env.SOCRATA_APP_TOKEN || '';
  // Cliente con App Token Socrata (aumenta el rate limit de datos.gov.co)
  const sodaClient = axios.create({
    timeout: parseInt(process.env.SODA_API_TIMEOUT || '120000', 10),
    headers: SODA_APP_TOKEN ? { 'X-App-Token': SODA_APP_TOKEN } : {},
  });

  // Fuentes SECOP I (Procesos f789-7hwg o Integrado rpmr-utcd): su estado no es una
  // señal fiable de "abierto a ofertas" y su lag es mayor; la vigencia la decide isExpired.
  const isSecop1Source = (c: any): boolean => {
    return c._source === 'secop_i_procesos' || c._source === 'secop_i_integrado';
  };

  const statusFilter = status && status.length > 0
    ? status.map((s: string) => `'${escapeSoql(s)}'`).join(', ')
    : `'Convocado', 'Presentación de oferta', 'Abierto', 'Publicado'`;

  const queryParams: any = {
       $limit: 1000,
    $order: 'fecha_de_publicacion_del DESC',
  };

  // Collect post-fetch filters for client-side filtering
  const postFetchFilters: Array<(c: any) => boolean> = [];
  const filters: string[] = [];

  // Always apply status filter
  filters.push(`estado_del_procedimiento IN (${statusFilter})`);

  // Budget filters
  if (minBudget !== undefined) filters.push(`precio_base >= ${parseFloat(minBudget)}`);
  if (maxBudget !== undefined) filters.push(`precio_base <= ${parseFloat(maxBudget)}`);

  // UNSPSC codes
  if (unspscCodes && unspscCodes.length > 0) {
    const codeFilters = unspscCodes.map((c: string) =>
      `codigo_principal_de_categoria LIKE '%${escapeSoql(c)}%'`
    ).join(' OR ');
    filters.push(`(${codeFilters})`);
  }

  // Department filter
  if (department) {
    const deptNorm = normalize(department);
    filters.push(
      `(departamento_entidad LIKE '%${escapeSoql(department)}%' OR upper(departamento_entidad) LIKE '%${escapeSoql(deptNorm)}%')`
    );
  }

  // Search text
  if (searchText) {
    const searchNorm = normalize(searchText);
    filters.push(`upper(descripci_n_del_procedimiento) LIKE '%${escapeSoql(searchNorm)}%'`);
  }

  // Municipio filter strategy - use BOTH $q AND $where (two queries) for maximum coverage
  if (municipio) {
    // We'll do two searches: $q for full-text, $where for ciudad_entidad match
    // Then combine results. This ensures we capture contracts that either
    // mention municipio in entidad/descripción OR have it in ciudad_entidad.
    delete queryParams.$order;
    queryParams.$limit = 3000;
    console.log(`[SODA] Using dual search for municipio: "${municipio}"`);
  } else if (filters.length > 0) {
    queryParams.$where = filters.join(' AND ');
  }

  console.log(`[SODA Search] Query:`, JSON.stringify(queryParams).substring(0, 300));

  try {
    // Helper to build URL from query params
    const buildUrl = (params: Record<string, string | number>, baseUrl?: string): string => {
      const queryParts: string[] = [];
      for (const [key, value] of Object.entries(params)) {
        queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
      return `${baseUrl || SODA_API_URL}?${queryParts.join('&')}`;
    };

    // When searching by municipio, do TWO queries and combine:
    // 1. $q: full-text search (captures entidad, descripción mentions)
    // 2. $q with municipality + department (fast alternative to heavy $where)
    let results: any[] = [];
    if (municipio && !queryParams.$where) {
      // Query 1: full-text search
      const qParams: Record<string, string | number> = {
        $q: municipio,
        $limit: '1500',
      };
      const qUrl = buildUrl(qParams);
      console.log(`[SODA] Query 1 ($q): ${qUrl.substring(0, 120)}`);
      
      const qResponse = await sodaClient.get(qUrl, {
        timeout: parseInt(process.env.SODA_API_TIMEOUT || '120000', 10),
      });
      const qResults = qResponse.data || [];
      console.log(`[SODA] Query 1 results: ${qResults.length}`);

      // Query 2: combine municipality + department in $q (fast full-text,
      // much faster than $where LIKE which is heavy for SODA)
      const wParams: Record<string, string | number> = {
        $q: `"${municipio}" ${department || ''}`.trim(),
        $limit: '1500',
      };
      const wUrl = buildUrl(wParams);
      console.log(`[SODA] Query 2 ($q dept): ${wUrl.substring(0, 120)}`);
      
      const wResponse = await sodaClient.get(wUrl, {
        timeout: parseInt(process.env.SODA_API_TIMEOUT || '120000', 10),
      });
      const wResults = wResponse.data || [];
      console.log(`[SODA] Query 2 results: ${wResults.length}`);

      // Combine and dedupe by id_del_proceso
      const seenIds = new Set();
      results = [...qResults, ...wResults].filter((c: any) => {
        const secopId = c.id_del_proceso;
        if (!secopId || seenIds.has(secopId)) return false;
        seenIds.add(secopId);
        return true;
      });
      console.log(`[SODA] Combined results (deduped): ${results.length}`);

      // Query 3: SECOP I - Procesos de Compra Pública (f789-7hwg) - captures
      // entities that publish in SECOP I (e.g. many alcaldías municipales).
      // This dataset is kept up to date (daily) and has fecha_de_cargue_en_el_secop.
      // Query by department + Convocado state, then filter municipio client-side
      // (municipio LIKE in the query is too slow on this large dataset).
      if (municipio) {
        try {
          const SECOP1_PROCESSES_URL = process.env.SECOP1_PROCESSES_URL || 'https://www.datos.gov.co/resource/f789-7hwg.json';
          const secop1Params: Record<string, string | number> = {
            $where: `upper(departamento_entidad) LIKE '%${escapeSoql(normalize(department || ''))}%'`,
            $select: 'nombre_entidad,departamento_entidad,municipio_entidad,estado_del_proceso,modalidad_de_contratacion,detalle_del_objeto_a_contratar,objeto_a_contratar,numero_de_proceso,numero_de_contrato,cuantia_proceso,fecha_de_cargue_en_el_secop,ruta_proceso_en_secop_i',
            $limit: '500',
          };
          const secop1Url = buildUrl(secop1Params, SECOP1_PROCESSES_URL);
          console.log(`[SODA] Query 3 (SECOP I): ${secop1Url.substring(0, 150)}`);
          
          const secop1Response = await sodaClient.get(secop1Url, {
            timeout: parseInt(process.env.SODA_API_TIMEOUT || '120000', 10),
          });
          let secop1Results = secop1Response.data || [];
          console.log(`[SODA] Query 3 results: ${secop1Results.length}`);
          
          // Transform SECOP I records to match SECOP II shape and merge.
          // Keep Convocado processes that match the selected municipio.
          const transformed = secop1Results
            .filter((c: any) => {
              const state = (c.estado_del_proceso || '').toUpperCase();
              if (state !== 'CONVOCADO') return false;
              const munNorm = normalize(municipio);
              const muniNorm = normalize(c.municipio_entidad || '');
              const entNorm = normalize(c.nombre_entidad || '');
              return muniNorm.includes(munNorm) || entNorm.includes(munNorm);
            })
            .map((c: any) => ({
              id_del_proceso: c.numero_de_proceso || c.numero_de_contrato || '',
              entidad: c.nombre_entidad || '',
              departamento_entidad: c.departamento_entidad || '',
              ciudad_entidad: c.municipio_entidad || '',
              descripci_n_del_procedimiento: c.detalle_del_objeto_a_contratar || c.objeto_a_contratar || '',
              estado_del_procedimiento: c.estado_del_proceso || '',
              fase: 'Presentación de oferta',
              estado_de_apertura_del_proceso: 'Abierto',
              precio_base: c.cuantia_proceso || 0,
               urlproceso: c.ruta_proceso_en_secop_i || { url: '' },
               fecha_de_publicacion_del: c.fecha_de_cargue_en_el_secop || null,
               _source: 'secop_i_procesos',
               modalidad_de_contratacion: c.modalidad_de_contratacion || '',
               tipo_de_contrato: c.tipo_de_contrato || '',
            }));
          console.log(`[SODA] SECOP I after filter: ${transformed.length}`);
          
          // Merge (SECOP II takes priority on duplicate IDs)
          const seenSecopII = new Set(results.map((c: any) => c.id_del_proceso));
          for (const t of transformed) {
            if (t.id_del_proceso && !seenSecopII.has(t.id_del_proceso)) {
              results.push(t);
              seenSecopII.add(t.id_del_proceso);
            }
          }
          console.log(`[SODA] After SECOP I merge: ${results.length}`);

          // Query 3c: SECOP Integrado (rpmr-utcd) as a fast fallback that can
          // query by municipio directly. It may lag but catches any Convocado
          // not present in the SECOP I processes slice.
          try {
            const SECOP_INTEGRADO_URL = process.env.SECOP_INTEGRADO_URL || 'https://www.datos.gov.co/resource/rpmr-utcd.json';
            const integParams: Record<string, string | number> = {
              $where: `upper(estado_del_proceso) = 'CONVOCADO' AND upper(departamento_entidad) LIKE '%${escapeSoql(normalize(department || ''))}%' AND (upper(municipio_entidad) LIKE '%${escapeSoql(normalize(municipio))}%' OR upper(municipio_entidad) LIKE '%${escapeSoql(municipio.toUpperCase())}%')`,
              $select: 'nombre_de_la_entidad,nit_de_la_entidad,departamento_entidad,municipio_entidad,estado_del_proceso,modalidad_de_contrataci_n,objeto_del_proceso,objeto_a_contratar,numero_de_proceso,numero_del_contrato,valor_contrato,url_contrato,fecha_de_firma_del_contrato',
              $limit: '300',
            };
            const integUrl = buildUrl(integParams, SECOP_INTEGRADO_URL);
            console.log(`[SODA] Query 3c (Integrado): ${integUrl.substring(0, 140)}`);
            const integResponse = await sodaClient.get(integUrl, {
              timeout: parseInt(process.env.SODA_API_TIMEOUT || '120000', 10),
            });
            const integResults = integResponse.data || [];
            console.log(`[SODA] Query 3c results: ${integResults.length}`);
            
            const integTransformed = integResults.map((c: any) => {
              let pubDate = c.fecha_de_firma_del_contrato || null;
              if (!pubDate && c.url_contrato) {
                const match = c.url_contrato.match(/numConstancia=(\d{2})-\d{1,2}-(\d+)/);
                if (match) {
                  const year = 2000 + parseInt(match[1], 10);
                  pubDate = `${year}-07-01T00:00:00.000`;
                }
              }
              return {
                id_del_proceso: c.numero_de_proceso || c.numero_del_contrato || '',
                entidad: c.nombre_de_la_entidad || '',
                departamento_entidad: c.departamento_entidad || '',
                ciudad_entidad: c.municipio_entidad || '',
                descripci_n_del_procedimiento: c.objeto_del_proceso || c.objeto_a_contratar || '',
                estado_del_procedimiento: c.estado_del_proceso || '',
                fase: 'Presentación de oferta',
                estado_de_apertura_del_proceso: 'Abierto',
                precio_base: c.valor_contrato || 0,
                urlproceso: { url: c.url_contrato || '' },
                fecha_de_publicacion_del: pubDate,
                _source: 'secop_i_integrado',
                modalidad_de_contratacion: c.modalidad_de_contrataci_n || '',
                tipo_de_contrato: c.tipo_de_contrato || '',
              };
            });
            const seenIds3c = new Set(results.map((c: any) => c.id_del_proceso));
            for (const t of integTransformed) {
              if (t.id_del_proceso && !seenIds3c.has(t.id_del_proceso)) {
                results.push(t);
                seenIds3c.add(t.id_del_proceso);
              }
            }
            console.log(`[SODA] After Integrado fallback merge: ${results.length}`);
          } catch (e3c: any) {
            console.log(`[SODA] Query 3c failed: ${e3c.message}`);
          }
        } catch (e: any) {
          console.log(`[SODA] SECOP I query failed: ${e.message}`);
        }
      }
    } else {
      // No municipio or already have $where - single query
      const queryParts: string[] = [];
      for (const [key, value] of Object.entries(queryParams)) {
        queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
      const fullUrl = `${SODA_API_URL}?${queryParts.join('&')}`;
      console.log(`[SODA] URL: ${fullUrl.substring(0, 120)}`);
      
      const response = await sodaClient.get(fullUrl, {
        timeout: parseInt(process.env.SODA_API_TIMEOUT || '120000', 10),
      });
      results = response.data;
      console.log(`[SODA] Resultados iniciales: ${results.length}`);
    }

    // Apply client-side filters for status, budget, unspsc, department, searchText
    // Default status filter - include active processes that users can still participate in
    const statusList = status && status.length > 0
      ? status : ['Convocado', 'Presentación de oferta', 'Abierto', 'Publicado', 'Seleccionado', 'Evaluación', 'Cancelado'];
    
    results = results.filter((c: any) => {
      // Status filter - for SECOP I records the status is not a reliable
      // "open to offers" signal; isExpired handles vigencia. For SECOP II,
      // keep only known process states.
      if (!isSecop1Source(c) && !statusList.includes(c.estado_del_procedimiento)) return false;
    
      // Budget filters
      if (minBudget !== undefined && (parseFloat(c.precio_base) || 0) < parseFloat(minBudget)) return false;
      if (maxBudget !== undefined && (parseFloat(c.precio_base) || 0) > parseFloat(maxBudget)) return false;
    
      // UNSPSC codes
      if (unspscCodes && unspscCodes.length > 0) {
        const cat = c.codigo_principal_de_categoria || '';
        if (!unspscCodes.some((code: string) => cat.includes(code))) return false;
      }
    
      // Department filter
      if (department) {
        const depExact = c.departamento_entidad || '';
        const deptNorm = normalize(department);
        const depNorm = normalize(depExact);
        if (!depExact.toLowerCase().includes(department.toLowerCase()) && !depNorm.includes(deptNorm)) {
          return false;
        }
      }

      // Strict municipality filter: when a municipio is selected, the record's
      // ciudad_entidad must match it (or be undefined but with the entity name
      // mentioning the municipio). This removes false positives from $q full-text
      // that mention the municipio only in the description.
      if (municipio) {
        const munNorm = normalize(municipio);
        const ciudadNorm = normalize(c.ciudad_entidad || '');
        const entidadNorm = normalize(c.entidad || '');
        const ciudadReal = (c.ciudad_entidad || '').toLowerCase();
        const ciudadEsNoDefinido = !c.ciudad_entidad || /no definido|sin informaci/i.test(c.ciudad_entidad || '');
        
        const matchesCiudad = ciudadNorm.includes(munNorm) || ciudadReal.includes(municipio.toLowerCase());
        const matchesEntidad = entidadNorm.includes(munNorm);
        
        if (!matchesCiudad && !matchesEntidad) {
          return false;
        }
        // If the record's own municipio is a different real one (not "No Definido"),
        // it must match - this filters out Neiva/Tello/Algeciras false positives.
        if (!ciudadEsNoDefinido && !matchesCiudad && matchesEntidad) {
          return false;
        }
      }
      
      // Search text
      if (searchText) {
        const searchNorm = normalize(searchText);
        const desc = normalize(c.descripci_n_del_procedimiento || '');
        if (!desc.includes(searchNorm)) return false;
      }
    
      return true;
    });
    console.log(`[SODA] Después de filtros adicionales: ${results.length} resultados`);

    // Deduplicate by secopId (unique contract identifier in SECOP)
    const seenIds = new Set();
    results = results.filter((c: any) => {
      const secopId = c.id_del_proceso;
      if (!secopId || seenIds.has(secopId)) return false;
      seenIds.add(secopId);
      return true;
    });
    console.log(`[SODA] Después de deduplicación: ${results.length} resultados únicos`);

    // Sort results strictly by publication date DESC (newest first).
    // Records without a date go last. Done once here; the expired grouping
    // below relies on the fact that expired processes are naturally older.
    const getSortDate = (c: any): number => {
      const d = c.fecha_de_publicacion_del || c.fecha_publicacion_proceso || c.fecha_inicio_proceso;
      if (!d) return 0;
      const t = new Date(d).getTime();
      return isNaN(t) ? 0 : t;
    };
    if (municipio && !results[0]?.departamento_entidad?.includes('error')) {
      results.sort((a: any, b: any) => {
        const dateA = getSortDate(a);
        const dateB = getSortDate(b);
        // Missing dates go last
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateB - dateA;
      });
    }

    // Filter out expired results (closingDate in the past) if closingDate is available
    const now = new Date();
    const isExpiredFn = (c: any): boolean => {
      // 1. If the response/offer deadline date (fecha_de_recepcion_de) exists
      //    and has already passed, the process can no longer accept offers
      const realClose = c.fecha_de_recepcion_de ||
                        c.fecha_de_presentacion_de_la_oferta || 
                        c.fecha_fin_procedimiento ||
                        c.fecha_limite_presentacion;
      if (realClose) {
        return new Date(realClose).getTime() < now.getTime();
      }
      // 2. Process state must still accept offers
      const activeStates = ['Publicado', 'Convocado', 'Abierto', 'Presentación de oferta'];
      if (!activeStates.includes(c.estado_del_procedimiento)) {
        return true;
      }
      // 3. Opening state must be open
      if (c.estado_de_apertura_del_proceso !== 'Abierto') {
        return true;
      }
      // 4. Recency check: a process published over MAX_AGE_DAYS ago without a
      //    future closing date is stale data (SECOP II data may lag) and
      //    effectively expired. SECOP I (Integrado) has a longer lag, so give
      //    its "Convocado" processes a wider window.
      if (c.fecha_de_publicacion_del) {
        const MAX_AGE_MS = isSecop1Source(c) ? 540 * 24 * 60 * 60 * 1000 : 90 * 24 * 60 * 60 * 1000;
        if (now.getTime() - new Date(c.fecha_de_publicacion_del).getTime() > MAX_AGE_MS) {
          return true;
        }
      }
      return false;
    };
    const expiredCount = results.filter(isExpiredFn).length;
    console.log(`[SODA] Resultados expirados: ${expiredCount} / ${results.length}`);
    
    // The results are already sorted strictly by publication date DESC above.
    // No further re-sorting is applied to preserve the newest-first order.

    const payload = {
      results: results.slice(0, 1000).map((c: any) => ({
        secopId: c.id_del_proceso,
        entity: c.entidad,
        title: c.descripci_n_del_procedimiento,
        budget: parseFloat(c.precio_base) || 0,
        urlPliego: c.urlproceso?.url || '',
        phase: c.fase || '',
        status: c.estado_del_procedimiento || '',
        department: c.departamento_entidad || '',
        municipio: c.ciudad_entidad || '',
        publishedAt: c.fecha_de_publicacion_del || 
                    c.fecha_publicacion_proceso || 
                    c.fecha_inicio_proceso || 
                    null,
        closingDate: c.fecha_de_recepcion_de || 
                    c.fecha_de_presentacion_de_la_oferta || 
                    c.fecha_fin_procedimiento ||
                    c.fecha_limite_presentacion ||
                    null,
        isOpen: c.estado_de_apertura_del_proceso === 'Abierto' || false,
        awarded: c.adjudicado === 'Si' || false,
        isExpired: isExpiredFn(c),
        category: c.codigo_principal_de_categoria || '',
        duration: `${c.duracion || ''} ${c.unidad_de_duracion || ''}`.trim(),
        modality: c.modalidad_de_contratacion || '',
        source: c._source || 'secop_ii',
      })),
      total: results.length,
    };
    searchCache.set(cacheKey, payload);
    res.json(payload);
  } catch (error: any) {
    // Detect SODA rate limiting / server errors
    const status = error?.response?.status;
    if (status === 429 || status === 503 || (error?.message || '').includes('status code 500')) {
      res.status(429).json({
        error: 'SECOP está temporalmente limitando las consultas',
        detail: 'Espera un momento y vuelve a intentar. Si persiste, espera unos minutos.',
        rateLimited: true,
      });
    } else {
      res.status(500).json({ error: 'Error buscando en SECOP', detail: error.message });
    }
  }
});

export default router;
