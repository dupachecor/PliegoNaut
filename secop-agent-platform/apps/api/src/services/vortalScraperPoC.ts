// ===== PoC de viabilidad: scraping de VORTAL (Fase 2.0) =====
// Script EXPERIMENTAL y standalone. NO se importa desde el flujo de la API.
//
// Objetivo: validar que un navegador stealth puede:
//   1. Cargar la lista pública de avisos de community.secop.gov.co
//   2. Sortear el bloqueo (WAF de Azure + posible ReCaptcha)
//   3. Extraer al menos 1 aviso (noticeUID) sin ser baneado
//
// Estrategias GRATUITAS (sin servicio de captcha de pago):
//   - puppeteer-extra-plugin-stealth  → evita detección por fingerprint
//   - puppeteer-extra-plugin-recaptcha con reCaptchaMode:'manual' → si el
//     captcha aparece, pausa para resolución humana (modo headful)
//
// Si además configuras TWOCAPTCHA_API_KEY, la PoC intenta auto-resolver.
//
// Uso:
//   npm run poc:vortal -- --attempts 3 --headful
//   node dist/services/vortalScraperPoC.js --attempts 3
//
// Flags:
//   --attempts N    número de intentos (default 3)
//   --headful       abre el navegador visible (necesario para resolver captcha manual)
//   --url <url>     URL a probar (default: lista de avisos)
//   --out <dir>     directorio de resultados (default storage/poc)
//   --chrome <path> ruta explícita al binario de Chromium
//   --no-stealth    desactiva el plugin stealth (baseline de comparación)

import { addExtra } from 'puppeteer-extra';
import puppeteerCore from 'puppeteer-core';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { VORTAL, noticesListUrl } from '../config/vortal';

const log = (...args: any[]) => console.log('[POC]', ...args);

// Enlazar puppeteer-core explícitamente: evita la resolución automática de
// puppeteer-extra (que falla con la instalación anidada de los workspaces).
const puppeteer = addExtra(puppeteerCore as any);

// ===== CLI args =====
function parseArgs(): {
  attempts: number;
  headful: boolean;
  url: string;
  outDir: string;
  chromePath?: string;
  useStealth: boolean;
  debug: boolean;
} {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  return {
    attempts: parseInt(get('--attempts') || '3', 10),
    headful: argv.includes('--headful'),
    url: get('--url') || noticesListUrl(),
    outDir: get('--out') || path.resolve(process.cwd(), 'storage/poc'),
    chromePath: get('--chrome'),
    useStealth: !argv.includes('--no-stealth'),
    debug: argv.includes('--debug'),
  };
}

// ===== Detección del binario de Chromium =====
// Prioridad: --chrome > CHROME_PATH > PUPPETEER_EXECUTABLE_PATH >
// caché de ms-playwright (el que ya usa el worker).
function resolveChromePath(explicit?: string): string | undefined {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  if (process.env.PUPPETEER_EXECUTABLE_PATH) candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);

  // Buscar en el caché de Playwright (chromium-<ver>/chrome-linux*/chrome)
  try {
    const pwDir = path.join(os.homedir(), '.cache/ms-playwright');
    if (fs.existsSync(pwDir)) {
      const chromiumDirs = fs
        .readdirSync(pwDir)
        .filter((d) => d.startsWith('chromium'))
        .sort();
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface AttemptResult {
  attempt: number;
  ok: boolean;
  blocked: boolean;
  captchaDetected: boolean;
  captchaSolved: boolean;
  captchaDetails: any[];
  noticesFound: number;
  noticeUids: string[];
  firstRowText: string;
  rowsHtml?: string;
  url: string;
  durationMs: number;
  screenshot?: string;
  error?: string;
}

// ===== Detección de página de bloqueo =====
function looksBlocked(pageText: string): boolean {
  return (
    /403|forbidden|access denied|error 403/i.test(pageText) ||
    pageText.includes('Microsoft-Azure-Application-Gateway')
  );
}

// ¿Sigue visible el intersticial de reCAPTCHA?
async function captchaStillVisible(page: any): Promise<boolean> {
  try {
    const anchor = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe')).some(
        (f) => (f as HTMLIFrameElement).src?.includes('recaptcha/api2/anchor'),
      );
    });
    return anchor;
  } catch {
    return false;
  }
}

// Espera a que el intersticial de captcha desaparezca (lo resuelve un humano
// en la ventana visible, o un solver si hay clave). Hace polling del DOM.
async function waitForCaptchaPassage(page: any, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    const stillThere = await captchaStillVisible(page);
    const title = await page.evaluate(() => document.title).catch(() => '');
    if (!stillThere && title.toLowerCase() !== 'recaptcha') {
      return true;
    }
  }
  return false;
}

// ===== Extracción adaptativa de avisos =====
async function extractNotices(page: any): Promise<{ uids: string[]; firstRow: string; rowsHtml: string; usedSelector: string; skipped: string[] }> {
  const data = await page.evaluate((selectors: any) => {
    // noticeUID puede vivir en href, en atributos data-* o en handlers onclick
    const uidPattern = /noticeUID[^A-Za-z0-9]*([A-Za-z0-9][A-Za-z0-9.-]{3,})/i;
    const hrefs = Array.from(document.querySelectorAll('a[href]'))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((h) => h && h.toLowerCase().includes('noticeuid'));
    const uids = Array.from(new Set(
      hrefs.map((h) => {
        const m = h.match(/noticeUID[^A-Za-z0-9]*([A-Za-z0-9][A-Za-z0-9.-]{3,})/i);
        return m ? m[1] : null;
      }).filter(Boolean) as string[],
    ));

    // VORTAL pone el UID en el onclick del link "Detalle" (concatenación JS)
    const uidsFromOnclick: string[] = [];
    const detailLinks = Array.from(document.querySelectorAll("a[onclick*='noticeUID'], a[onclick*='OpportunityDetail']"));
    for (const a of detailLinks) {
      const onclick = a.getAttribute('onclick') || '';
      const m = onclick.match(uidPattern);
      if (m && !uidsFromOnclick.includes(m[1])) uidsFromOnclick.push(m[1]);
    }

    // Fuente alternativa: cualquier atributo que contenga el UID en el DOM
    const allUids = Array.from(new Set(
      Array.from(document.querySelectorAll('*'))
        .map((el) => {
          for (const attr of ['href', 'data-noticeuid', 'data-id', 'id', 'onclick']) {
            const v = (el as any)[attr];
            if (typeof v === 'string') {
              const m = v.match(uidPattern);
              if (m) return m[1];
            }
          }
          return null;
        })
        .filter(Boolean) as string[],
    ));

    let firstRow = '';
    let rowsHtml = '';
    let usedSelector = '';
    const skipped: string[] = [];
    // Elegir la primera tabla de resultados con más de 1 fila (evita breadcrumbs/headers)
    const tableCandidates = selectors.resultGrid && selectors.resultGrid.length
      ? [...selectors.resultGrid, ...(selectors.lastModifiedGrid || []), ...selectors.tableRow]
      : selectors.tableRow;
    for (const sel of tableCandidates) {
      const table = document.querySelector(sel);
      if (!table) continue;
      const trs = table.querySelectorAll('tr');
      if (trs.length <= 1) continue;
      const tableText = (table as HTMLElement).innerText || '';
      // solo ignorar tablas "vacías": pocas filas Y mensaje de no-resultados
      if (trs.length <= 2 && /no existen resultados|no se han encontrado/i.test(tableText)) {
        skipped.push(`${sel} (vacio)`);
        continue;
      }
      usedSelector = sel;
      firstRow = (trs[0] as HTMLElement).innerText?.slice(0, 500) || '';
      const header = (trs[0] as HTMLElement).innerText || '';
      const isHeader = /país|entidad|referencia|descripci|fase|últimas/i.test(header);
      rowsHtml = Array.from(trs)
        .slice(0, isHeader ? 4 : 3)
        .map((tr) => (tr as HTMLElement).outerHTML)
        .join('\n');
      break;
    }
    return { uids, allUids, uidsFromOnclick, firstRow, rowsHtml, usedSelector, skipped };
  }, VORTAL.selectors);

  return {
    uids: [...new Set([...(data.uids || []), ...(data.uidsFromOnclick || []), ...(data.allUids || [])])],
    firstRow: data.firstRow,
    rowsHtml: data.rowsHtml,
    usedSelector: data.usedSelector,
    skipped: data.skipped,
  };
}

// ===== Intento individual =====
async function runAttempt(
  attempt: number,
  opts: ReturnType<typeof parseArgs>,
  browser: any,
  userDataDir: string,
): Promise<AttemptResult> {
  const started = Date.now();
  const result: AttemptResult = {
    attempt,
    ok: false,
    blocked: false,
    captchaDetected: false,
    captchaSolved: false,
    captchaDetails: [],
    noticesFound: 0,
    noticeUids: [],
    firstRowText: '',
    url: opts.url,
    durationMs: 0,
  };

  let page: any;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    );

    log(`[intento ${attempt}] Navegando a ${opts.url}`);
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000); // dar tiempo al WAF/Angular

    // ===== Detección y manejo de ReCaptcha =====
    let captchaResult: any = null;
    try {
      if (typeof (page as any).solveRecaptchas === 'function') {
        captchaResult = await (page as any).solveRecaptchas();
      }
    } catch {}
    const captchas = captchaResult?.captchas ?? [];
    result.captchaDetected = captchas.length > 0;
    result.captchaSolved = captchas.some((c: any) => c.isSolved);
    result.captchaDetails = captchas.map((c: any) => ({
      sitekey: c.sitekey,
      type: c.type,
      isSolved: c.isSolved,
      error: c.error || null,
    }));

    if (captchas.length > 0) {
      log(`[intento ${attempt}] ReCaptcha detectado (${captchas.length}). ` +
        `Resueltos: ${result.captchaSolved ? 'sí' : 'no'} | ` +
        `tipos: ${result.captchaDetails.map((c) => c.type).join(', ')}`);
      if (!result.captchaSolved) {
        if (opts.headful) {
          const manualTimeout = parseInt(process.env.MANUAL_SOLVE_TIMEOUT_MS || '180000', 10);
          log(`[intento ${attempt}] >>> RESUELVE EL CAPTCHA EN LA VENTANA DEL NAVEGADOR <<< ` +
            `(esperando hasta ${(manualTimeout / 1000).toFixed(0)}s)`);
          result.captchaSolved = await waitForCaptchaPassage(page, manualTimeout);
          if (result.captchaSolved) log(`[intento ${attempt}] Captcha superado (manual/solver)`);
          else log(`[intento ${attempt}] Captcha NO superado en el tiempo dado`);
        } else {
          log(`[intento ${attempt}] Captcha presente y no resuelto. Usa --headful para resolución manual.`);
        }
      }
    }

    // ===== Screenshot (evidencia) =====
    try {
      const shot = path.join(opts.outDir, `attempt-${attempt}.png`);
      await page.screenshot({ path: shot });
      result.screenshot = shot;
    } catch {}

    // ===== Ejecutar la búsqueda (el grid no se puebla solo con params de URL) =====
    try {
      const btn = await page.waitForSelector('#btnSearchButton', { timeout: 8000 });
      if (btn) {
        log(`[intento ${attempt}] Ejecutando búsqueda (btnSearchButton)...`);
        await page.evaluate(() => {
          const el = document.getElementById('btnSearchButton') as HTMLInputElement | null;
          if (el) el.click();
        });
        // la búsqueda hace un POST/navegación; esperar a que el grid se repueble
        await sleep(10000);
      }
    } catch (e: any) {
      log(`[intento ${attempt}] btnSearchButton no disponible: ${e?.message}`);
    }

    // ===== Esperar render de la tabla (SPA Angular) =====
    let tableRendered = false;
    for (const sel of VORTAL.selectors.tableRow) {
      try {
        await page.waitForSelector(sel, { timeout: 8000 });
        tableRendered = true;
        break;
      } catch {}
    }
    if (!tableRendered) {
      await sleep(5000); // último intento: espera genérica
    }

    // ===== Comprobar bloqueo =====
    const bodyText: string = await page.evaluate(() => document.body?.innerText || '');
    result.blocked = looksBlocked(bodyText);

    // ===== Diagnóstico DOM (para entender el captcha / la página) =====
    try {
      const diag = await page.evaluate((selectors: any) => {
        const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => ({
          src: (f as HTMLIFrameElement).src?.slice(0, 120),
          visible: !!(f as HTMLElement).offsetParent,
        }));
        const captchaNodes = Array.from(document.querySelectorAll("[class*='g-recaptcha']")).length;
        let rowsInTable = 0;
        let tableSel = '';
        for (const sel of selectors.tableRow) {
          const rows = document.querySelectorAll(sel).length;
          if (rows > rowsInTable) { rowsInTable = rows; tableSel = sel; }
        }
        const tables = Array.from(document.querySelectorAll('table')).map((t) => ({
          id: t.id,
          cls: (t as HTMLElement).className?.toString().slice(0, 60),
          trs: t.querySelectorAll('tr').length,
          firstRow: t.querySelector('tr')?.innerText?.slice(0, 160) || '',
        }));
        const hrefs = Array.from(document.querySelectorAll('a[href]'))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => h && !h.includes('javascript:'))
          .slice(0, 25);
        const form = document.querySelector('#frmMainForm') as HTMLFormElement | null;
        const formFields = form
          ? Array.from(form.querySelectorAll('input, select')).map((el: any) => ({
              name: el.name,
              type: el.type || 'select',
              value: (el.value || '').slice(0, 40),
              id: el.id,
            })).filter((f) => f.name || f.id).slice(0, 40)
          : [];
        const searchButtons = Array.from(document.querySelectorAll('input[type=button], button'))
          .map((b) => (b as HTMLElement).id || (b as HTMLButtonElement).value || (b as HTMLElement).innerText?.slice(0, 20))
          .filter(Boolean)
          .slice(0, 15);
        return {
          title: document.title,
          iframes,
          captchaNodes,
          tableSel,
          rowsInTable,
          bodyLen: document.body?.innerText?.length || 0,
          tables,
          hrefs,
          formAction: form?.action || '',
          formFields,
          searchButtons,
        };
      }, VORTAL.selectors);
      log(`[intento ${attempt}] DIAG: título="${diag.title}" | iframes=${JSON.stringify(diag.iframes)} | ` +
        `g-recaptcha nodes=${diag.captchaNodes} | tabla "${diag.tableSel}" filas=${diag.rowsInTable} | body=${diag.bodyLen} chars`);
      if (opts.debug) {
        for (const t of diag.tables) {
          log(`[intento ${attempt}] TABLA: id="${t.id}" cls="${t.cls}" filas=${t.trs} primera="${t.firstRow.slice(0, 100)}"`);
        }
        for (const h of diag.hrefs) {
          if (/notice|process|contract/i.test(h)) log(`[intento ${attempt}] HREF: ${h.slice(0, 140)}`);
        }
        log(`[intento ${attempt}] FORM action="${diag.formAction}"`);
        for (const f of diag.formFields) {
          log(`[intento ${attempt}] FIELD name="${f.name}" id="${f.id}" type="${f.type}" value="${f.value}"`);
        }
        log(`[intento ${attempt}] BUTTONS: ${JSON.stringify(diag.searchButtons)}`);
      }
      result.captchaDetails = diag;
    } catch (e: any) {
      log(`[intento ${attempt}] DIAG error: ${e?.message}`);
    }

    // ===== Extraer avisos =====
    const { uids, firstRow, rowsHtml, usedSelector, skipped } = await extractNotices(page);
    result.noticeUids = uids;
    result.firstRowText = firstRow;
    result.rowsHtml = rowsHtml;
    result.noticesFound = uids.length;
    log(`[intento ${attempt}] extract: selector="${usedSelector}" avisos=${uids.length} skipped=${JSON.stringify(skipped)}`);

    if (rowsHtml) {
      try {
        const htmlFile = path.join(opts.outDir, `attempt-${attempt}-rows.html`);
        fs.writeFileSync(htmlFile, rowsHtml);
        log(`[intento ${attempt}] HTML de filas guardado en ${htmlFile}`);
      } catch {}
    }

    result.ok = !result.blocked && uids.length > 0;
    result.durationMs = Date.now() - started;

    log(`[intento ${attempt}] blocked=${result.blocked} avisos=${uids.length} ` +
      `captcha=${result.captchaDetected} duración=${(result.durationMs / 1000).toFixed(1)}s`);
    if (uids.length > 0) log(`[intento ${attempt}] primer noticeUID: ${uids[0]}`);
    if (firstRow) log(`[intento ${attempt}] primera fila: ${firstRow.slice(0, 120)}...`);
  } catch (err: any) {
    result.error = err?.message || String(err);
    result.durationMs = Date.now() - started;
    log(`[intento ${attempt}] ERROR: ${result.error}`);
  } finally {
    if (page) await page.close().catch(() => {});
  }
  return result;
}

// ===== Main =====
async function main() {
  const opts = parseArgs();
  const chromePath = resolveChromePath(opts.chromePath);
  const userDataDir = path.resolve(opts.outDir, 'user_data');

  if (!chromePath) {
    log('No se encontró un binario de Chromium. Usa --chrome <path> o instala Playwright.');
    process.exit(1);
  }
  log(`Chromium: ${chromePath}`);
  log(`Intentos: ${opts.attempts} | headful: ${opts.headful} | stealth: ${opts.useStealth}`);
  log(`Resultados: ${opts.outDir}`);

  if (opts.useStealth) puppeteer.use(StealthPlugin());

  const twocaptcha = process.env.TWOCAPTCHA_API_KEY;
  if (twocaptcha) {
    log('TWOCAPTCHA_API_KEY presente → auto-resolución de captcha activada');
  }
  // Estrategia GRATUITA: provider 'click' auto-clic al checkbox de reCAPTCHA v2.
  // Si aparece un challenge de imágenes, no podrá resolverlo (ahí se necesitaría
  // 2captcha o resolución humana en modo headful). Con TWOCAPTCHA_API_KEY se usa 2captcha.
  puppeteer.use(
    RecaptchaPlugin({
      visualFeedback: true,
      ...(twocaptcha
        ? { provider: { id: '2captcha' as const, token: twocaptcha } }
        : { provider: { id: 'click' as const } }),
    }),
  );

  fs.mkdirSync(opts.outDir, { recursive: true });

  let browser: any;
  try {
    browser = await puppeteer.launch({
      headless: !opts.headful,
      executablePath: chromePath,
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const results: AttemptResult[] = [];
    for (let i = 1; i <= opts.attempts; i++) {
      results.push(await runAttempt(i, opts, browser, userDataDir));
      if (i < opts.attempts) {
        const delay = VORTAL.rateLimit.minDelayMs + Math.floor(Math.random() * (VORTAL.rateLimit.maxDelayMs - VORTAL.rateLimit.minDelayMs));
        log(`Esperando ${(delay / 1000).toFixed(0)}s antes del siguiente intento...`);
        await sleep(delay);
      }
    }

    const success = results.filter((r) => r.ok).length;
    const blocked = results.filter((r) => r.blocked).length;
    const captchaHit = results.filter((r) => r.captchaDetected).length;
    const successRate = (success / results.length) * 100;

    const summary = {
      fecha: new Date().toISOString(),
      url: opts.url,
      intentos: results.length,
      exito: success,
      exitoRate: successRate,
      bloqueado: blocked,
      captchaVisto: captchaHit,
      captchaResuelto: results.filter((r) => r.captchaSolved).length,
      intentosDetalle: results,
    };

    const outFile = path.join(opts.outDir, `vortal-poc-${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
    log(`Resultados guardados en ${outFile}`);

    console.log('\n===== RESUMEN PoC VORTAL =====');
    console.log(`  Éxito: ${success}/${results.length} (${successRate.toFixed(0)}%)`);
    console.log(`  Bloqueado: ${blocked} | Captcha visto: ${captchaHit}`);
    console.log(`  Criterio GO (>=80%): ${successRate >= 80 ? 'GO ✅' : 'NO-GO ❌'}`);
    console.log('===============================\n');
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  log('FATAL:', err);
  process.exit(1);
});
