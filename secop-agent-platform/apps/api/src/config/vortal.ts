// ===== Configuración VORTAL (Fase 2 del PLAN_TIEMPO_REAL.md) =====
// Selectores y límites parametrizados para el scraping de community.secop.gov.co.
// La UI de VORTAL es una SPA Angular que puede cambiar: si se rompe el scraper,
// este archivo es el ÚNICO lugar que se debe tocar (no tocar la lógica).

export interface VortalSelectorSet {
  tableRow: string[];      // filas de la tabla de avisos
  resultGrid: string[];    // tabla de resultados (VortalGrid)
  lastModifiedGrid: string[]; // tabla "ÚLTIMAS MODIFICACIONES" (panel lateral)
  noticeLink: string[];    // enlaces al detalle (contienen noticeUID)
  nextPage: string[];      // paginación
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
  },
  rateLimit: {
    minDelayMs: 30000,
    maxDelayMs: 60000,
    maxScrapesPerWindowMin: 1,
    windowMinutes: 15,
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

export function noticesListUrl(): string {
  // Búsqueda con ventana amplia desde inicio de año (los params los expone la
  // propia grilla en sus onclick de ordenación: PublishDateFrom/To, OrderParam).
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const params = new URLSearchParams({
    isLV: '0',
    RecordsPerPage: '10',
    PublishDateFrom: `01/01/${now.getFullYear()} 00:00:00`,
    PublishDateTo: fmt(now),
    OrderParam: 'RequestOnlinePublishingDateDESC',
    SearchExecuted: 'True',
  });
  return `${VORTAL.baseUrl}${VORTAL.noticesPath}?${params.toString()}`;
}

export function noticeDetailUrl(noticeUid: string): string {
  const params = new URLSearchParams(VORTAL.defaultQuery);
  params.set('noticeUID', noticeUid);
  return `${VORTAL.baseUrl}${VORTAL.noticesPath}?${params.toString()}`;
}
