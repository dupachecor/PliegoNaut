// ===== Configuración VORTAL (Fase 2 del PLAN_TIEMPO_REAL.md) =====
// Selectores y límites parametrizados para el scraping de community.secop.gov.co.
// La UI de VORTAL es una SPA Angular que puede cambiar: si se rompe el scraper,
// este archivo es el ÚNICO lugar que se debe tocar (no tocar la lógica).

import fs from 'fs';
import os from 'os';
import path from 'path';

export interface VortalSelectorSet {
  tableRow: string[];      // filas de la tabla de avisos
  resultGrid: string[];    // tabla de resultados (VortalGrid)
  lastModifiedGrid: string[]; // tabla "ÚLTIMAS MODIFICACIONES" (panel lateral)
  noticeLink: string[];    // enlaces al detalle (contienen noticeUID)
  nextPage: string[];      // paginación
  searchButton: string[];   // botón "Buscar" del formulario
  recaptchaIframe: string[]; // iframes de ReCaptcha
  captchaField: string[];  // contenedores de captcha
  loginInput: string[];    // inputs de login (detección de sesión)
  documentsTab: string[];  // pestaña de documentos en el detalle
  documentLink: string[];  // enlaces de documentos (descarga)
}

export interface VortalConfig {
  baseUrl: string;
  noticesPath: string;
  defaultQuery: Record<string, string>;
  selectors: VortalSelectorSet;
  rateLimit: {
    minDelayMs: number;
    maxDelayMs: number;
    maxScrapesPerWindowMin: number;
    windowMinutes: number;
    userAgents: string[]; // pool de User-Agent rotativo (Fase 2.7)
  };
  limits: {
    maxDocSizeMB: number;
    downloadTimeoutMs: number;
    maxConcurrentDownloads: number;
    maxRowsPerPage: number;
  };
  source: string;
  // Ventana de "nuevo proceso": solo se ingesta lo publicado en las últimas N horas
  newProcessWindowHours: number;
}

export const VORTAL: VortalConfig = {
  baseUrl: process.env.VORTAL_BASE_URL || 'https://community.secop.gov.co',
  noticesPath: '/Public/Tendering/ContractNoticeManagement/Index',
  // Los avisos públicos se filtran por estado "Publicado" (estado 1 en VORTAL)
  defaultQuery: {
    isLV: '0',
    RecordsPerPage: '10',
    customValues: '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0',
  },
  selectors: {
    tableRow: [
      "table.VortalGrid tbody tr",
      "table[class*='VortalGrid'] tbody tr",
      "#grdResultList_tbl tbody tr",
      "table tbody tr",
      "tr[role='row']",
      ".k-grid tbody tr",
      "mat-row",
    ],
    resultGrid: [
      "table.VortalGrid",
      "table[class*='VortalGrid']",
      "#grdResultList_tbl",
    ],
    lastModifiedGrid: [
      "table.FullWidthTable",
      "table[id*='LastModified']",
      "#objlnklstLastModifiedNIEs",
    ],
    noticeLink: [
      "a[href*='noticeUID']",
      "a[href*='ContractNoticeManagement']",
      "a[href*='noticeUID=']",
    ],
    nextPage: [
      "a[title='Siguiente']",
      "button:has-text('Siguiente')",
      ".k-pager-next",
      "a[aria-label='Next']",
    ],
    recaptchaIframe: [
      "iframe[src*='recaptcha']",
      "iframe[src*='recaptcha.net']",
      "iframe[src*='hcaptcha']",
      "iframe[src*='hc-captcha']",
    ],
    captchaField: [
      "div.g-recaptcha",
      "div[class*='g-recaptcha']",
      "iframe[src*='recaptcha']",
      "div[class*='captcha']",
    ],
    loginInput: [
      "input[name='UserName']",
      "input[name='userName']",
      "input[placeholder*='usuario']",
      "input[placeholder*='Usuario']",
    ],
    documentsTab: [
      "a:has-text('Documentos')",
      "button:has-text('Documentos')",
      "text=Documentos del Proceso",
    ],
    documentLink: [
      "a[href*='Download']",
      "a[href*='download']",
      "a:has-text('Descargar')",
      "button:has-text('Descargar')",
      "a[href*='GetDocument']",
    ],
    searchButton: [
      "#btnSearchButton",
      "input#btnSearchButton",
      "input[value='Buscar']",
    ],
  },
  rateLimit: {
    minDelayMs: parseInt(process.env.VORTAL_MIN_DELAY_MS || '30000', 10),
    maxDelayMs: parseInt(process.env.VORTAL_MAX_DELAY_MS || '60000', 10),
    maxScrapesPerWindowMin: parseInt(process.env.VORTAL_MAX_SCRAPES_PER_WINDOW || '1', 10),
    windowMinutes: parseInt(process.env.VORTAL_WINDOW_MINUTES || '15', 10),
    userAgents: [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    ],
  },
  limits: {
    maxDocSizeMB: 50,
    downloadTimeoutMs: 120000,
    maxConcurrentDownloads: 5,
    maxRowsPerPage: 10,
  },
  source: 'vortal_scraped',
  newProcessWindowHours: 2,
};

export const VORTAL_BASE_URL = VORTAL.baseUrl;

// ===== Runtime / scraper (2.1) =====
export const VORTAL_CRON_SCHEDULE = process.env.VORTAL_CRON_SCHEDULE || '*/15 * * * *';
export const VORTAL_SCRAPER_ENABLED = process.env.VORTAL_SCRAPER_ENABLED === 'true';
export const VORTAL_HEADFUL = process.env.VORTAL_HEADFUL === 'true';
export const VORTAL_USER_DATA_DIR =
  process.env.VORTAL_USER_DATA_DIR || path.resolve(process.cwd(), 'storage/vortal/user_data');
export const VORTAL_DOCS_DIR =
  process.env.VORTAL_DOCS_DIR || path.resolve(process.cwd(), 'storage/pliegos');
export const VORTAL_MANUAL_SOLVE_TIMEOUT_MS = parseInt(
  process.env.MANUAL_SOLVE_TIMEOUT_MS || '180000',
  10,
);

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// VORTAL interpreta las fechas en hora de Bogotá (UTC-5). La máquina local está en ese huso,
// así que los componentes de hora local de `new Date()` son directamente correctos.
function fmtVortalDate(d: Date): string {
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function noticesListUrl(): string {
  // Búsqueda con ventana amplia desde inicio de año (los params los expone la
  // propia grilla en sus onclick de ordenación: PublishDateFrom/To, OrderParam).
  const now = new Date();
  const params = new URLSearchParams({
    isLV: '0',
    RecordsPerPage: '10',
    PublishDateFrom: `01/01/${now.getFullYear()} 00:00:00`,
    PublishDateTo: fmtVortalDate(now),
    OrderParam: 'RequestOnlinePublishingDateDESC',
    SearchExecuted: 'True',
  });
  return `${VORTAL.baseUrl}${VORTAL.noticesPath}?${params.toString()}`;
}

// Búsqueda restringida a la ventana de "proceso nuevo" (default 2 horas).
// El propio servidor filtra por fecha de publicación: el grid solo devuelve
// lo publicado en esas horas, ordenado por fecha DESC.
export function vortalSearchUrl(windowHours: number = VORTAL.newProcessWindowHours): string {
  const now = new Date();
  const from = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const params = new URLSearchParams({
    isLV: '0',
    RecordsPerPage: '10',
    PublishDateFrom: fmtVortalDate(from),
    PublishDateTo: fmtVortalDate(now),
    OrderParam: 'RequestOnlinePublishingDateDESC',
    SearchExecuted: 'True',
  });
  return `${VORTAL.baseUrl}${VORTAL.noticesPath}?${params.toString()}`;
}

export function noticeDetailUrl(noticeUid: string): string {
  const params = new URLSearchParams({
    noticeUID: noticeUid,
    isFromPublicArea: 'True',
    isModal: 'true',
    asPopupView: 'true',
  });
  return `${VORTAL.baseUrl}/Public/Tendering/OpportunityDetail/Index?${params.toString()}`;
}

// ===== Resolución del binario de Chromium =====
// Prioridad: VORTAL_CHROME_PATH > CHROME_PATH > PUPPETEER_EXECUTABLE_PATH >
// caché de ms-playwright (el que ya usa el worker).
export function resolveChromePath(explicit?: string): string | undefined {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  if (process.env.VORTAL_CHROME_PATH) candidates.push(process.env.VORTAL_CHROME_PATH);
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  if (process.env.PUPPETEER_EXECUTABLE_PATH) candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);

  try {
    const pwDir = path.join(os.homedir(), '.cache/ms-playwright');
    if (fs.existsSync(pwDir)) {
      const chromiumDirs = fs.readdirSync(pwDir).filter((d) => d.startsWith('chromium')).sort();
      for (const dir of chromiumDirs) {
        const base = path.join(pwDir, dir);
        for (const sub of fs.readdirSync(base)) {
          const bin = path.join(base, sub, 'chrome');
          if (fs.existsSync(bin)) candidates.push(bin);
        }
      }
    }
  } catch {}

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return undefined;
}
