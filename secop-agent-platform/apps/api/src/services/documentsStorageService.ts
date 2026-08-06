// ===== Almacenamiento de documentos VORTAL (Fase 2.2) =====
// Lógica pura: guardado de PDFs descargados, checksum SHA256 (dedup), validación
// de que el archivo es un PDF real (no una página HTML de error) y límites.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { VORTAL } from '../config/vortal';

export interface StoredDocument {
  fileName: string;
  storagePath: string;
  checksum: string;
  sizeBytes: number;
}

const PDF_MAGIC = Buffer.from('%PDF-');
const HTML_MAGIC = Buffer.from('<');

export function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Un PDF válido empieza por "%PDF-" y NO es HTML (página de error del portal).
export function looksLikePdf(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 8) return false;
  if (!buffer.subarray(0, 5).equals(PDF_MAGIC)) return false;
  // descartar "PDF" embebido en HTML
  if (buffer.subarray(0, 1).equals(HTML_MAGIC)) return false;
  return true;
}

// Ruta destino: storage/pliegos/{secopId}/{docId}.pdf (docId saneado).
export function buildStoragePath(
  baseDir: string,
  secopId: string,
  docId: string,
  fileName: string,
): string {
  const safeSecop = secopId.replace(/[^A-Za-z0-9._-]/g, '_');
  const safeDoc = docId.replace(/[^A-Za-z0-9._-]/g, '_');
  const ext = path.extname(fileName) || '.pdf';
  const dir = path.join(baseDir, safeSecop);
  return path.join(dir, `${safeDoc}${ext}`);
}

export function savePdf(
  buffer: Buffer,
  storagePath: string,
): StoredDocument {
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(storagePath, buffer);
  return {
    fileName: path.basename(storagePath),
    storagePath,
    checksum: sha256(buffer),
    sizeBytes: buffer.length,
  };
}

// El límite de tamaño se aplica ANTES de escribir (evita llenar disco con PDFs corruptos).
export function exceedsMaxSize(buffer: Buffer): boolean {
  return buffer.length > VORTAL.limits.maxDocSizeMB * 1024 * 1024;
}
