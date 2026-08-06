import axios from 'axios';
import axiosRetry from 'axios-retry';
import { prisma } from '@pliegonaut/database';
import { computeMatchScore } from './sodaIngestService';

// ===== LEGACY / DEPRECADO (Fase 1.1) =====
// Este scanner queda SOLO para el trigger manual (POST /api/trigger-scanner) y
// para escaneos puntuales por empresa con filtros SODA server-side.
// El cron programado usa la ingestión incremental (sodaIngestService + cron/sodaIngest)
// que trae SOLO registros nuevos desde la última ingesta (marca de agua en IngestLog).

const SODA_API_URL = process.env.SODA_API_URL || 'https://www.datos.gov.co/resource/p6dx-8zbt.json';
const SODA_TIMEOUT = parseInt(process.env.SODA_API_TIMEOUT || '30000', 10);
const SODA_APP_TOKEN = process.env.SOCRATA_APP_TOKEN || '';
const MAX_CONCURRENT_COMPANIES = 3;

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

function escapeSoql(value: string): string {
  return value.replace(/'/g, "''");
}

function parseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

type Logger = { info: (msg: string, ...args: any[]) => void; error: (msg: string, ...args: any[]) => void };

async function scanCompany(company: any, log: Logger): Promise<{ nuevos: number; procesados: number }> {
  const unspscArray = company.unspscCodes
    ? company.unspscCodes.split(',').map((c: string) => c.trim()).filter(Boolean)
    : [];
  const unspscFilter = unspscArray.length > 0
    ? unspscArray.map((code: string) =>
        `codigo_principal_de_categoria LIKE '%${escapeSoql(code)}%'`
      ).join(' OR ')
    : "1=1";

  const queryParams = {
    $where: `(${unspscFilter}) AND precio_base >= ${company.minBudget} AND precio_base <= ${company.maxBudget} AND estado_del_procedimiento IN ('Convocado', 'Presentación de oferta', 'Abierto', 'Publicado')`,
    $limit: 100,
    $order: 'fecha_de_publicacion_del DESC',
  };

  const response = await sodaClient.get(SODA_API_URL, { params: queryParams });
  const contracts = response.data;

  const regionsArray = company.regions
    ? company.regions.split(',').map((r: string) => r.trim()).filter(Boolean)
    : [];

  const filteredContracts = regionsArray.length > 0
    ? contracts.filter((c: any) => regionsArray.includes(c.departamento_entidad))
    : contracts;

  const existingIds = await prisma.contractMatch.findMany({
    where: { companyId: company.id },
    select: { secopId: true },
  });
  const existingSet = new Set(existingIds.map((e) => e.secopId));

  let nuevos = 0;
  const batchSize = 10;
  const newContracts = [];

  for (const contract of filteredContracts) {
    const secopId = contract.id_del_proceso || '';
    if (!secopId || existingSet.has(secopId)) continue;

    const urlProceso = contract.urlproceso?.url || contract.url_del_proceso || '';
    const matchScore = computeMatchScore(company, contract);

    newContracts.push({
      companyId: company.id,
      secopId,
      entity: contract.entidad || 'Sin entidad',
      title: contract.descripci_n_del_procedimiento || 'Sin descripción',
      budget: parseFloat(contract.precio_base) || 0,
      urlPliego: urlProceso,
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
      closingDate: parseDate(
        contract.fecha_de_recepcion_de ||
        contract.fecha_de_presentacion_de_la_oferta ||
        contract.fecha_fin_procedimiento ||
        contract.fecha_limite_presentacion
      ),
      presentationDeadline: parseDate(contract.fecha_de_recepcion_de || contract.fecha_de_presentacion_de_la_oferta),
      matchScore,
      rawSodaData: JSON.stringify(contract),
    });
  }

  for (let i = 0; i < newContracts.length; i += batchSize) {
    await prisma.contractMatch.createMany({
      data: newContracts.slice(i, i + batchSize),
    });
    nuevos += Math.min(batchSize, newContracts.length - i);
  }

  log.info(`[SODA] ${company.name}: ${newContracts.length} nuevos de ${filteredContracts.length} encontrados`);
  return { nuevos, procesados: filteredContracts.length };
}

export async function runDailySecopScanner(logger?: Logger) {
  const log = logger || { info: console.log, error: console.error };
  log.info('[SODA] Iniciando escaneo SECOP II');
  const startTime = Date.now();

  const companies = await prisma.company.findMany({ orderBy: { createdAt: 'desc' } });

  const chunks: any[][] = [];
  for (let i = 0; i < companies.length; i += MAX_CONCURRENT_COMPANIES) {
    chunks.push(companies.slice(i, i + MAX_CONCURRENT_COMPANIES));
  }

  let totalNew = 0;
  let totalProcessed = 0;

  for (const chunk of chunks) {
    const chunkResults = await Promise.allSettled(
      chunk.map((company) => scanCompany(company, log))
    );
    for (const r of chunkResults) {
      if (r.status === 'fulfilled') {
        totalNew += r.value.nuevos;
        totalProcessed += r.value.procesados;
      } else {
        log.error(`[SODA] Error en lote: ${r.reason}`);
      }
    }
  }

  const duration = Date.now() - startTime;
  log.info(`[SODA] Escaneo completado: ${totalProcessed} procesados, ${totalNew} nuevos en ${duration}ms`);
}
