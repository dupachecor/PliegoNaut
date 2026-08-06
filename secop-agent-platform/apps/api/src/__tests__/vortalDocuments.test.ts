import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  sha256,
  looksLikePdf,
  buildStoragePath,
  savePdf,
  exceedsMaxSize,
} from '../services/documentsStorageService';
import { inferDocumentType } from '../services/vortalDocumentsService';

describe('documentsStorageService', () => {
  it('sha256 es estable', () => {
    expect(sha256('hola')).toBe(sha256('hola'));
    expect(sha256('hola')).toHaveLength(64);
    expect(sha256('hola')).not.toBe(sha256('hola2'));
  });

  it('looksLikePdf: acepta PDF real y rechaza HTML', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7\n...'))).toBe(true);
    expect(looksLikePdf(Buffer.from('<html>error</html>'))).toBe(false);
    expect(looksLikePdf(Buffer.from('NOTPDF'))).toBe(false);
    expect(looksLikePdf(Buffer.from('%PDF-'))).toBe(false); // muy corto (<8 bytes)
  });

  it('buildStoragePath: ruta saneada por secopId y docId', () => {
    const p = buildStoragePath('/base', 'CO1.NTC.1', '791131943', 'CDP.pdf');
    expect(p).toBe(path.join('/base', 'CO1.NTC.1', '791131943.pdf'));
    const p2 = buildStoragePath('/base', 'A/B', 'x:y', 'doc.pdf');
    expect(p2).not.toContain('/B');
    expect(p2).toContain('A_B');
  });

  it('savePdf escribe y devuelve checksum+size', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pliego-test-'));
    const buf = Buffer.from('%PDF-1.7 test');
    const stored = savePdf(buf, path.join(dir, 'a', 'b.pdf'));
    expect(fs.existsSync(stored.storagePath)).toBe(true);
    expect(stored.sizeBytes).toBe(buf.length);
    expect(stored.checksum).toBe(sha256(buf));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exceedsMaxSize: false para archivos pequeños', () => {
    expect(exceedsMaxSize(Buffer.alloc(1024))).toBe(false);
  });
});

describe('inferDocumentType', () => {
  it('clasifica pliego, addendo, aviso/anexo y otro', () => {
    expect(inferDocumentType('Pliego de Condiciones.pdf')).toBe('pliego');
    expect(inferDocumentType('Addenda 1.pdf')).toBe('addendo');
    expect(inferDocumentType('Anexo tecnico.pdf')).toBe('aviso');
    expect(inferDocumentType('Aviso de convocatoria.pdf')).toBe('aviso');
    expect(inferDocumentType('CDP.pdf')).toBe('otro');
  });
});
