// ===== Scraper VORTAL: detección de nuevos procesos (Fase 2.1) =====
// Navega la lista pública de avisos de community.secop.gov.co (SPA), ejecuta la
// búsqueda (ventana de N horas), extrae los procesos "Publicado" de la grilla y
// persiste en ContractMatch los noticeUID nuevos con source='vortal_scraped'.
//
// Sesión: usa un perfil de Chromium persistente (storage/vortal/user_data).
// El captcha reCAPTCHA v2 se resuelve UNA vez en modo headful (bootstrap manual);
// a partir de ahí las cookies evitan el intersticial (validado en la PoC 2.0).
//
// Pila: puppeteer-extra + puppeteer-core + stealth (la misma validada en la PoC;
// el plan sugería Playwright, pero aquí se reutiliza el stack ya probado contra VORTAL).

import { addExtra } from 'puppeteer-extra';
import puppeteerCore from 'puppeteer-core';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { prisma } from '@pliegonaut/database';
import { downloadDocumentsForNotices } from './vortalDocumentsService';
import { vortalFallback, VORTAL_MAX_FAILURES, VORTAL_FALLBACK_DURATION_MS } from '../lib/vortalFallback';
import { pickUserAgent, withRetry } from '../lib/vortalRateLimit';
import {
  VORTAL,
  vortalSearchUrl,
  VORTAL_HEADFUL,
  VORTAL_USER_DATA_DIR,
  VORTAL_MANUAL_SOLVE_TIMEOUT_MS,
  resolveChromePath,
} from '../config/vortal';

const puppeteer = addExtra(puppeteerCore as any);
puppeteer.use(StealthPlugin());

// Última raspada completada (rate limit de 1 por ventana, Fase 2.7).
let lastScrapeAt: number | null = null;

export interface VortalNoticeRow {
  noticeUid: string;
  country: string;
  entity: string;
  reference: string;
  description: string;
  phase: string;
  publishDate: Date | null;
  deadlineDate: Date | null;
  budget: number;
  status: string;
  url: string;
}

export interface VortalScrapeResult {
  ok: boolean;
  blocked: boolean;
  captchaSolved: boolean;
  fallback: boolean; // el scrape se omitió por fallback activo
  rateLimited: boolean; // el scrape se omitió por rate limit (máx 1/15min)
  vistos: number; // filas en grilla dentro de la ventana
  nuevos: number; // noticeUID nuevos persistidos
  documentos: number; // documentos PDF guardados (Fase 2.2)
  errores: number; // filas sin noticeUID (layout distinto)
  sessionId: string | null;
  durationMs: number;
  error?: string;
}

type Log = {
  info: (msg: string, ...args: any[]) => void;
  warn?: (msg: string, ...args: any[]) => void;
  error: (msg: string, ...args: any[]) => void;
};

const defaultLog: Log = {
  info: console.log,
  error: console.error,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UID_PATTERN = /noticeUID[^A-Za-z0-9]*([A-Za-z0-9][A-Za-z0-9.-]{3,})/i;

// ===== Parsers (exportados para tests) =====

// Fecha VORTAL: "8/05/2026 9:52 PM" (huso Bogotá, UTC-5). Devuelve un Date (epoch correcto).
export function parseVortalDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return null;
  const [, mo, d, y, h, mi, sRaw, ap] = m;
  let hh = parseInt(h, 10);
  if (/PM/i.test(ap) && hh < 12) hh += 12;
  if (/AM/i.test(ap) && hh === 12) hh = 0;
  const utc5 = Date.UTC(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10), hh, parseInt(mi, 10), parseInt(sRaw || '0', 10));
  return new Date(utc5 + 5 * 60 * 60 * 1000);
}

// Cuantía: texto tipo "$1.234.567 COP" → 1234567 (es-CO: puntos de miles).
export function parseVortalBudget(text: string | null | undefined): number {
  if (!text) return 0;
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return isNaN(n) ? 0 : n;
}

// ===== Helpers de navegación =====

async function captchaVisible(page: any): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      if ((document.title || '').toLowerCase() === 'recaptcha') return true;
      return Array.from(document.querySelectorAll('iframe')).some((f) =>
        (f as HTMLIFrameElement).src?.includes('recaptcha/api2/anchor'),
      );
    });
  } catch {
    return false;
  }
}

async function waitForCaptchaPassage(page: any, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    const stillThere = await captchaVisible(page);
    const title = await page.evaluate(() => document.title).catch(() => '');
    if (!stillThere && title.toLowerCase() !== 'recaptcha') return true;
  }
  return false;
}

async function clickSearch(page: any, log: Log): Promise<boolean> {
  try {
    await page.waitForSelector(VORTAL.selectors.searchButton[0], { timeout: 8000 });
    await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLButtonElement | null;
      if (el) el.click();
    }, VORTAL.selectors.searchButton[0]);
    log.info('[VORTAL] Búsqueda ejecutada (btnSearchButton)');
    await sleep(8000);
    return true;
  } catch (e: any) {
    log.error('[VORTAL] Botón de búsqueda no disponible:', e?.message);
    return false;
  }
}

// ===== Extracción de la grilla =====

// Transforma el JSON crudo extraído del DOM en filas tipadas (puro, testeable).
export function mapGridRows(raw: any[]): VortalNoticeRow[] {
  return raw
    .map((r: any): VortalNoticeRow => ({
      noticeUid: r.noticeUid,
      country: r.country,
      entity: r.entity,
      reference: r.reference,
      description: r.description,
      phase: r.phase,
      publishDate: parseVortalDate(r.publishDateText),
      deadlineDate: parseVortalDate(r.deadlineText),
      budget: parseVortalBudget(r.budgetText),
      status: r.status,
      url: r.url,
    }))
    .filter((r: VortalNoticeRow) => r.noticeUid);
}

export async function extractGridRows(page: any): Promise<VortalNoticeRow[]> {
  const raw = await page.evaluate((config: any) => {
    const gridSel: string = config.selectors.resultGrid[0] || 'table.VortalGrid';
    const table: HTMLTableElement | null = document.querySelector(gridSel);
    if (!table) return [];
    const rows: any[] = [];
    const trs: HTMLTableRowElement[] = Array.from(table.querySelectorAll('tr'));
    for (const tr of trs.slice(1)) {
      const tds: HTMLTableCellElement[] = Array.from(tr.querySelectorAll('td'));
      if (tds.length < 4) continue;
      const text = (i: number) => (tds[i] as HTMLElement)?.innerText?.trim() || '';
      const detail = tr.querySelector("a[onclick*='noticeUID'], a[onclick*='OpportunityDetail']");
      const onclick = detail?.getAttribute('onclick') || '';
      const m = onclick.match(/noticeUID[^A-Za-z0-9]*([A-Za-z0-9][A-Za-z0-9.-]{3,})/i);
      if (!m) continue;
      rows.push({
        noticeUid: m[1],
        country: text(0),
        entity: text(1),
        reference: text(2),
        description: text(3),
        phase: text(4),
        publishDateText: text(5),
        deadlineText: text(6),
        budgetText: text(7),
        status: text(8),
        url: `${config.baseUrl}/Public/Tendering/OpportunityDetail/Index?noticeUID=${encodeURIComponent(m[1])}&isFromPublicArea=True&isModal=true&asPopupView=true`,
      });
    }
    return rows;
  }, VORTAL);

  return mapGridRows(raw);
}

// ===== Persistencia =====

async function findExistingVortalUids(): Promise<Set<string>> {
  const rows = await prisma.contractMatch.findMany({
    where: { vortalNoticeUid: { not: null } },
    select: { vortalNoticeUid: true },
  });
  return new Set(rows.map((r) => r.vortalNoticeUid as string));
}

async function persistNewNotices(
  rows: VortalNoticeRow[],
  existing: Set<string>,
  log: Log,
): Promise<{ nuevos: number; noticeUids: string[] }> {
  const companies = await prisma.company.findMany({ select: { id: true } });
  if (companies.length === 0) {
    log.info('[VORTAL] No hay empresas registradas; no se persisten matches');
    return { nuevos: 0, noticeUids: [] };
  }

  const toInsert = rows.filter((r) => !existing.has(r.noticeUid));
  if (toInsert.length === 0) {
    log.info('[VORTAL] Sin noticeUID nuevos en la ventana');
    return { nuevos: 0, noticeUids: [] };
  }

  let nuevos = 0;
  for (const row of toInsert) {
    for (const company of companies) {
      try {
        await prisma.contractMatch.create({
          data: {
            companyId: company.id,
            secopId: row.noticeUid,
            vortalNoticeUid: row.noticeUid,
            entity: row.entity || 'Sin entidad',
            title: row.description || row.reference || 'Sin descripción',
            budget: row.budget,
            urlPliego: row.url,
            status: 'PENDING_ANALYSIS',
            phase: row.phase || '',
            contractStatus: row.status || 'Publicado',
            department: '',
            region: '',
            publishedAt: row.publishDate,
            closingDate: row.deadlineDate,
            presentationDeadline: row.deadlineDate,
            matchScore: 90, // detectado en tiempo real (VORTAL); el perfil lo evalúa el pipeline
            source: 'vortal_scraped',
            rawSodaData: JSON.stringify(row),
          },
        });
        nuevos++;
      } catch (err: any) {
        // P2002 = ya existe [companyId, secopId]; re-ejecución de cron. No es error.
        if (err?.code === 'P2002') continue;
        throw err;
      }
    }
  }
  log.info(`[VORTAL] ${nuevos} matches nuevos persistidos (${toInsert.length} noticeUID × ${companies.length} empresas)`);
  return { nuevos, noticeUids: toInsert.map((r) => r.noticeUid) };
}

// ===== Orquestador =====

export async function runVortalScrape(log: Log = defaultLog): Promise<VortalScrapeResult> {
  const started = Date.now();
  const result: VortalScrapeResult = {
    ok: false,
    blocked: false,
    captchaSolved: false,
    fallback: false,
    rateLimited: false,
    vistos: 0,
    nuevos: 0,
    documentos: 0,
    errores: 0,
    sessionId: null,
    durationMs: 0,
  };

  // ===== Rate limit: máx 1 raspada cada windowMinutes (Fase 2.7) =====
  const rateLimitWindowMs = VORTAL.rateLimit.windowMinutes * 60 * 1000;
  if (lastScrapeAt !== null && Date.now() - lastScrapeAt < rateLimitWindowMs) {
    result.rateLimited = true;
    result.ok = false;
    result.durationMs = 0;
    log.info(`[VORTAL] Rate limit: omitiendo (última raspada hace <${VORTAL.rateLimit.windowMinutes}min)`);
    return result;
  }
  lastScrapeAt = Date.now();

  // ===== Fallback activo (Fase 2.6): no ejecutar, la ingestión SODA sigue proveyendo =====
  if (vortalFallback.inFallback()) {
    const rem = Math.round(vortalFallback.remainingMs() / 60000);
    result.fallback = true;
    result.ok = false;
    result.durationMs = 0;
    log.info(`[VORTAL] Fallback activado - se omite el scrape (restan ~${rem}min). La ingestión SODA sigue proveyendo datos.`);
    return result;
  }

  const session = await prisma.scrapeSession.create({ data: { status: 'RUNNING' } });
  result.sessionId = session.id;

  const updateSession = async (patch: any) => {
    try {
      await prisma.scrapeSession.update({ where: { id: session.id }, data: patch });
    } catch {}
  };

  const chromePath = resolveChromePath();
  if (!chromePath) {
    await updateSession({ status: 'FAILED', errors: 'No se encontró Chromium', completedAt: new Date() });
    result.ok = false;
    result.error = 'No se encontró un binario de Chromium';
    if (vortalFallback.recordFailure()) {
      log.error(`[VORTAL] Fallback ACTIVADO tras ${VORTAL_MAX_FAILURES} fallos consecutivos (sin Chromium).`);
    }
    result.durationMs = Date.now() - started;
    return result;
  }

  fs.mkdirSync(VORTAL_USER_DATA_DIR, { recursive: true });
  log.info(`[VORTAL] Iniciando scrape (headful=${VORTAL_HEADFUL}) ventana=${VORTAL.newProcessWindowHours}h sesión=${session.id}`);

  let browser: any;
  try {
    browser = await puppeteer.launch({
      headless: !VORTAL_HEADFUL,
      executablePath: chromePath,
      userDataDir: VORTAL_USER_DATA_DIR,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent(pickUserAgent()); // UA rotativo (Fase 2.7)

    const url = vortalSearchUrl();
    log.info(`[VORTAL] Navegando a ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);

    // ===== Captcha (intersticial reCAPTCHA v2) =====
    if (await captchaVisible(page)) {
      if (VORTAL_HEADFUL) {
        log.info(`[VORTAL] >>> Resuelve el captcha en la ventana del navegador (${(VORTAL_MANUAL_SOLVE_TIMEOUT_MS / 1000).toFixed(0)}s) <<<`);
        result.captchaSolved = await waitForCaptchaPassage(page, VORTAL_MANUAL_SOLVE_TIMEOUT_MS);
      } else {
        result.captchaSolved = false;
      }
      if (!result.captchaSolved) {
        result.blocked = true;
        result.ok = false;
        if (vortalFallback.recordFailure()) {
          log.error(`[VORTAL] Fallback ACTIVADO tras ${VORTAL_MAX_FAILURES} fallos consecutivos (ReCaptcha no resuelto). ` +
            `Reintento automático en ~${VORTAL_FALLBACK_DURATION_MS / 60000}min.`);
        } else {
          log.error(`[VORTAL] Fallo #${vortalFallback.failuresCount}/${VORTAL_MAX_FAILURES} (ReCaptcha).`);
        }
        await updateSession({
          status: 'BLOCKED',
          captchaSolved: false,
          errors: 'ReCaptcha no resuelto. Ejecuta bootstrap manual: VORTAL_HEADFUL=true',
          completedAt: new Date(),
        });
        log.error('[VORTAL] BLOCKED: captcha sin resolver. Bootstrap manual: VORTAL_HEADFUL=true');
        result.durationMs = Date.now() - started;
        return result;
      }
      log.info('[VORTAL] Captcha superado');
    }

    // ===== Ejecutar búsqueda + extraer (con retry y backoff, Fase 2.7) =====
    const rows = await withRetry(
      async () => {
        await clickSearch(page, log);
        const r = await extractGridRows(page);
        if (r.length === 0) throw new Error('Grid vacío tras la búsqueda (posible layout o ban)');
        return r;
      },
      { retries: 2, baseDelayMs: 3000, maxDelayMs: 15000 },
    );
    const now = Date.now();
    const windowMs = VORTAL.newProcessWindowHours * 60 * 60 * 1000;
    const inWindow = rows.filter(
      (r) =>
        r.status.toLowerCase() === 'publicado' &&
        r.publishDate &&
        now - r.publishDate.getTime() <= windowMs &&
        r.publishDate.getTime() <= now + 60 * 60 * 1000, // tolerancia de reloj
    );
    result.vistos = inWindow.length;
    result.errores = rows.length - inWindow.length;
    log.info(`[VORTAL] Fila(s) extraídas=${rows.length} en ventana=${inWindow.length}`);

    // ===== Persistir nuevos =====
    const existing = await findExistingVortalUids();
    const { nuevos, noticeUids } = await persistNewNotices(inWindow, existing, log);
    result.nuevos = nuevos;

    // ===== Descargar documentos (Fase 2.2) en background, sin bloquear =====
    let guardados = 0;
    if (noticeUids.length > 0) {
      const docs = await downloadDocumentsForNotices(page, noticeUids, log);
      guardados = docs.guardados;
    }
    result.documentos = guardados;

    result.ok = true;
    vortalFallback.recordSuccess();
    await updateSession({
      status: 'OK',
      newProcesses: result.nuevos,
      newDocuments: guardados,
      errors: '',
      captchaSolved: result.captchaSolved,
      completedAt: new Date(),
    });
  } catch (err: any) {
    result.ok = false;
    result.error = err?.message || String(err);
    if (vortalFallback.recordFailure()) {
      log.error(`[VORTAL] Fallback ACTIVADO tras ${VORTAL_MAX_FAILURES} fallos consecutivos. ` +
        `Reintento automático en ~${VORTAL_FALLBACK_DURATION_MS / 60000}min.`);
    } else {
      log.error(`[VORTAL] Fallo #${vortalFallback.failuresCount}/${VORTAL_MAX_FAILURES}: ${result.error}`);
    }
    await updateSession({
      status: 'FAILED',
      errors: result.error,
      completedAt: new Date(),
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  result.durationMs = Date.now() - started;
  log.info(`[VORTAL] Completado: ok=${result.ok} nuevos=${result.nuevos} vistos=${result.vistos} en ${(result.durationMs / 1000).toFixed(1)}s`);
  return result;
}
