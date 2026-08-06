// ===== Descarga de documentos VORTAL (Fase 2.2) =====
// Para cada proceso (noticeUID) descarga TODOS sus documentos (pliego, addendos,
// avisos, anexos...), los valida como PDF, calcula checksum SHA256 (dedup) y los
// registra en ProcessDocument.
//
// Mecanismo descubierto en vivo:
//   1. En el detalle, cada "Descargar" llama a DownloadFile?documentFileId=<id>&mkey=<sesión>
//   2. DownloadFile responde HTML con redirect vía JS a
//      /Public/Archive/RetrieveFile/Index?DocumentId=<id>...
//   3. RetrieveFile devuelve el PDF (application/pdf, empieza por %PDF-)
//
// Las descargas usan Node fetch con las cookies del navegador (rápido, no bloquea
// el navegador) y respetan límites: 50MB, timeout 120s, máx 5 concurrentes.

import path from 'path';
import fs from 'fs';
import { prisma } from '@pliegonaut/database';
import { VORTAL, VORTAL_BASE_URL, VORTAL_DOCS_DIR } from '../config/vortal';
import { sha256, looksLikePdf, exceedsMaxSize, savePdf, buildStoragePath } from './documentsStorageService';

export interface VortalDocumentRef {
  documentFileId: string;
  fileName: string;
  documentType: string; // pliego | addendo | aviso | otro
  downloadUrl: string;
  mkey: string;
}

type Log = {
  info: (msg: string, ...args: any[]) => void;
  error: (msg: string, ...args: any[]) => void;
};

const defaultLog: Log = { info: console.log, error: console.error };

// ===== Tipo de documento según el nombre (pliego/addendo/aviso/anexo) =====
export function inferDocumentType(fileName: string): string {
  const n = fileName.toLowerCase();
  if (n.includes('pliego')) return 'pliego';
  if (n.includes('addend')) return 'addendo';
  if (/aviso|anexo|resoluci|invitaci/.test(n)) return 'aviso';
  return 'otro';
}

// ===== Extracción de la lista de documentos (página de detalle) =====
export async function extractDocumentRefs(page: any): Promise<VortalDocumentRef[]> {
  const raw = await page.evaluate((baseUrl: string) => {
    const results: any[] = [];
    const els = Array.from(document.querySelectorAll('a, input, button'));
    for (const el of els) {
      const onclick = el.getAttribute('onclick') || '';
      if (!onclick.includes('DownloadFile')) continue;
      const idM = onclick.match(/documentFileId[^0-9]*(\d+)/);
      const mkeyM = onclick.match(/mkey=([0-9a-f_]+)/i);
      if (!idM) continue;
      // nombre: texto de la fila/padre sin "Descargar"
      let fileName = '';
      const row = el.closest('tr') || el.closest('div[class]') || el.parentElement;
      if (row) {
        fileName = (row.innerText || '').replace(/Descargar/g, '').replace(/\s+/g, ' ').trim();
      }
      // si no salió nombre, usar el texto del propio elemento
      if (!fileName) fileName = ((el as HTMLElement).innerText || '').trim();
      results.push({
        documentFileId: idM[1],
        mkey: mkeyM ? mkeyM[1] : '',
        fileName: fileName || `documento_${idM[1]}.pdf`,
        downloadUrl: `${baseUrl}/Public/Tendering/OpportunityDetail/DownloadFile?documentFileId=${idM[1]}&mkey=${mkeyM ? mkeyM[1] : ''}`,
      });
    }
    return results;
  }, VORTAL_BASE_URL);

  return raw.map((r: any): VortalDocumentRef => ({
    documentFileId: r.documentFileId,
    mkey: r.mkey,
    fileName: r.fileName,
    documentType: inferDocumentType(r.fileName),
    downloadUrl: r.downloadUrl,
  }));
}

export async function getCookieHeader(page: any): Promise<string> {
  const cookies = await page.cookies(VORTAL_BASE_URL);
  return cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
}

// ===== Descarga de un PDF (DownloadFile → redirect JS → RetrieveFile) =====
export async function downloadDocumentPdf(
  cookieHeader: string,
  ref: VortalDocumentRef,
  timeoutMs: number = VORTAL.limits.downloadTimeoutMs,
): Promise<Buffer> {
  const baseHeaders = {
    Cookie: cookieHeader,
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
  };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let res = await fetch(ref.downloadUrl, { headers: baseHeaders, redirect: 'follow', signal: ctl.signal });
    let body = Buffer.from(await res.arrayBuffer());

    // seguir el redirect vía JS: window.location.href = '/Public/Archive/RetrieveFile/Index?...'
    const jsLoc = body.toString('latin1').match(/window\.location\.href\s*=\s*'([^']+)'/);
    if (jsLoc) {
      const target = jsLoc[1].startsWith('http') ? jsLoc[1] : VORTAL_BASE_URL + jsLoc[1];
      res = await fetch(target, { headers: baseHeaders, redirect: 'follow', signal: ctl.signal });
      body = Buffer.from(await res.arrayBuffer());
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// ===== Almacenar y registrar en ProcessDocument =====
async function storeAndRegister(
  ref: VortalDocumentRef,
  buffer: Buffer,
  contractId: string,
  secopId: string,
  log: Log,
): Promise<boolean> {
  if (exceedsMaxSize(buffer)) {
    log.error(`[VORTAL] ${ref.fileName}: supera ${VORTAL.limits.maxDocSizeMB}MB, se omite`);
    return false;
  }
  if (!looksLikePdf(buffer)) {
    log.error(`[VORTAL] ${ref.fileName}: no es un PDF válido (${buffer.length} bytes), se omite`);
    return false;
  }

  const storagePath = buildStoragePath(VORTAL_DOCS_DIR, secopId, ref.documentFileId, ref.fileName);
  const stored = savePdf(buffer, storagePath);

  try {
    await prisma.processDocument.upsert({
      where: {
        contractId_documentType_vortalDocId: {
          contractId,
          documentType: ref.documentType,
          vortalDocId: ref.documentFileId,
        },
      },
      create: {
        contractId,
        documentType: ref.documentType,
        vortalDocId: ref.documentFileId,
        fileName: ref.fileName,
        storagePath: stored.storagePath,
        downloadUrl: ref.downloadUrl,
        contentType: 'application/pdf',
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
      },
      update: {
        storagePath: stored.storagePath,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        fetchedAt: new Date(),
      },
    });
    return true;
  } catch (err: any) {
    log.error(`[VORTAL] Error registrando ${ref.fileName} en DB: ${err?.message}`);
    return false;
  }
}

// Pool simple de concurrencia (máx VORTAL.limits.maxConcurrentDownloads)
async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ===== Orquestador por proceso =====
// Precondición: `page` está cargado en la página de detalle del noticeUID.
export async function downloadDocumentsForNotice(
  page: any,
  noticeUid: string,
  log: Log = defaultLog,
): Promise<{ total: number; guardados: number; omitidos: number }> {
  const contract = await prisma.contractMatch.findFirst({
    where: { vortalNoticeUid: noticeUid },
    orderBy: { createdAt: 'asc' },
    select: { id: true, secopId: true },
  });
  if (!contract) {
    log.info(`[VORTAL] ${noticeUid}: sin ContractMatch asociado, sin documentos`);
    return { total: 0, guardados: 0, omitidos: 0 };
  }

  const refs = await extractDocumentRefs(page);
  log.info(`[VORTAL] ${noticeUid}: ${refs.length} documento(s) encontrados`);
  if (refs.length === 0) return { total: 0, guardados: 0, omitidos: 0 };

  const cookieHeader = await getCookieHeader(page);
  const timeoutMs = VORTAL.limits.downloadTimeoutMs;

  const results = await mapConcurrent(
    refs,
    VORTAL.limits.maxConcurrentDownloads,
    async (ref) => {
      try {
        const buffer = await downloadDocumentPdf(cookieHeader, ref, timeoutMs);
        const ok = await storeAndRegister(ref, buffer, contract.id, contract.secopId, log);
        if (ok) log.info(`[VORTAL] ${noticeUid}: descargado ${ref.fileName} (${buffer.length} bytes, ${ref.documentType})`);
        return ok;
      } catch (err: any) {
        log.error(`[VORTAL] ${noticeUid}: error descargando ${ref.fileName}: ${err?.message}`);
        return false;
      }
    },
  );

  const guardados = results.filter(Boolean).length;
  log.info(`[VORTAL] ${noticeUid}: ${guardados}/${refs.length} documentos guardados`);
  return { total: refs.length, guardados, omitidos: refs.length - guardados };
}

// Descarga los documentos de una lista de noticeUID, navegando el navegador a cada detalle.
export async function downloadDocumentsForNotices(
  page: any,
  noticeUids: string[],
  log: Log = defaultLog,
): Promise<{ totalDocs: number; guardados: number }> {
  if (noticeUids.length === 0) return { totalDocs: 0, guardados: 0 };
  let totalDocs = 0;
  let guardados = 0;
  for (const uid of noticeUids) {
    try {
      await page.goto(
        `${VORTAL_BASE_URL}/Public/Tendering/OpportunityDetail/Index?noticeUID=${encodeURIComponent(uid)}&isFromPublicArea=True&isModal=true&asPopupView=true`,
        { waitUntil: 'domcontentloaded', timeout: 60000 },
      );
      await new Promise((r) => setTimeout(r, 3000));
      const r = await downloadDocumentsForNotice(page, uid, log);
      totalDocs += r.total;
      guardados += r.guardados;
    } catch (err: any) {
      log.error(`[VORTAL] ${uid}: error en detalle/documentos: ${err?.message}`);
    }
  }
  return { totalDocs, guardados };
}
