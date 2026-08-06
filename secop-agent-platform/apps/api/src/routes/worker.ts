import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '@pliegonaut/database';

import { requireWorkerKey } from '../middleware/auth';
import { validate, analysisSchema } from '../middleware/validate';

const router = Router();

// Worker task polling - atomic claim (FOR UPDATE SKIP LOCKED)
router.get('/api/worker/tasks', requireWorkerKey, async (_req, res) => {
  const tasks = await prisma.$transaction(async (tx) => {
    // Claim atómico: la subconsulta bloquea (FOR UPDATE) y salta (SKIP LOCKED) las
    // filas que otro worker está reclamando en ese instante. Sin esto, dos workers
    // pueden leer las mismas filas PENDING y procesar el mismo contrato dos veces.
    const claimed = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`
        UPDATE "ContractMatch"
        SET status = 'PROCESSING', "updatedAt" = now()
        WHERE id IN (
          SELECT id FROM "ContractMatch"
          WHERE status = 'PENDING_ANALYSIS'
          ORDER BY "matchScore" DESC, "createdAt" ASC
          LIMIT 5
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id
      `
    );

    if (claimed.length === 0) return [];

    const ids = claimed.map((c) => c.id);
    return tx.contractMatch.findMany({
      where: { id: { in: ids } },
      include: { company: true },
      orderBy: [{ matchScore: 'desc' }, { createdAt: 'asc' }],
    });
  });

  res.json(tasks);
});

// Worker analysis submission
router.patch('/api/worker/tasks/:id/analysis', requireWorkerKey, validate(analysisSchema), async (req, res) => {
  const { id } = req.params;
  const { status, viabilityScore, reportLegal, reportFinancial, reportFinal, presentationRoute, errorMessage } = req.body;

  const existing = await prisma.contractMatch.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: 'Contrato no encontrado' });
  }
  if (existing.status !== "PROCESSING") {
    return res.status(409).json({ error: `El contrato ya fue procesado (estado: ${existing.status})` });
  }

  const updated = await prisma.contractMatch.update({
    where: { id },
    data: {
      status,
      viabilityScore,
      reportLegal,
      reportFinancial,
      reportFinal,
      presentationRoute,
      errorMessage,
      retryCount: { increment: errorMessage ? 1 : 0 },
    },
  });

  res.json(updated);
});

// Worker health check
router.get('/api/worker/health', async (_req, res) => {
  res.json({ status: 'ok', service: 'api' });
});

export default router;
