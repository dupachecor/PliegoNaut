// ===== Endpoints de documentos (Fase 2.4) =====
// GET /api/contracts/:secopId/documents           -> lista de pliegos/avisos de un proceso
// GET /api/contracts/:secopId/documents/:docId/download -> streaming del PDF

import { Router } from 'express';
import fs from 'fs';
import { prisma } from '@pliegonaut/database';
import { requireApiKey } from '../middleware/auth';

const router = Router();

// El proceso puede haberse ingerido por SODA (secopId) o por VORTAL (vortalNoticeUid).
function contractWhere(secopId: string) {
  return { OR: [{ secopId }, { vortalNoticeUid: secopId }] };
}

// Lista los documentos disponibles de un proceso
router.get('/api/contracts/:secopId/documents', requireApiKey, async (req, res) => {
  const { secopId } = req.params;

  const contract = await prisma.contractMatch.findFirst({
    where: contractWhere(secopId),
    orderBy: { createdAt: 'asc' },
    select: { id: true, secopId: true, vortalNoticeUid: true },
  });
  if (!contract) {
    return res.status(404).json({ error: 'Proceso no encontrado' });
  }

  const documents = await prisma.processDocument.findMany({
    where: { contractId: contract.id },
    orderBy: [{ documentType: 'asc' }, { fileName: 'asc' }],
    select: {
      id: true,
      documentType: true,
      fileName: true,
      sizeBytes: true,
      checksum: true,
      fetchedAt: true,
      downloadUrl: true,
    },
  });

  res.json({
    secopId: contract.secopId,
    vortalNoticeUid: contract.vortalNoticeUid || null,
    documents,
  });
});

// Streaming del PDF
router.get('/api/contracts/:secopId/documents/:docId/download', requireApiKey, async (req, res) => {
  const { secopId, docId } = req.params;

  const contract = await prisma.contractMatch.findFirst({
    where: contractWhere(secopId),
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!contract) {
    return res.status(404).json({ error: 'Proceso no encontrado' });
  }

  const doc = await prisma.processDocument.findFirst({
    where: { id: docId, contractId: contract.id },
  });
  if (!doc) {
    return res.status(404).json({ error: 'Documento no encontrado' });
  }

  if (!doc.storagePath || !fs.existsSync(doc.storagePath)) {
    return res.status(404).json({ error: 'Archivo no disponible en disco' });
  }

  // sendFile hace streaming y setea Content-Length automáticamente
  res.sendFile(doc.storagePath, {
    headers: {
      'Content-Type': doc.contentType || 'application/pdf',
      // filename*= para nombres con acentos (RFC 5987)
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
    },
  });
});

export default router;
