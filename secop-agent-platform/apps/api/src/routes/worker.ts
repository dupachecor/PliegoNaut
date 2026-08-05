import { Router } from 'express';
import { prisma } from '@pliegonaut/database';

import { requireWorkerKey } from '../middleware/auth';
import { validate, analysisSchema } from '../middleware/validate';

const router = Router();

// Worker task polling - atomic claim
router.get('/api/worker/tasks', requireWorkerKey, async (_req, res) => {
  // Use raw transaction to atomically claim tasks
  const tasks = await prisma.$transaction(async (tx) => {
    const pending = await tx.contractMatch.findMany({
      where: { status: "PENDING_ANALYSIS" },
      include: { company: true },
      take: 5,
      orderBy: [{ matchScore: 'desc' }, { createdAt: 'asc' }],
    });

    if (pending.length > 0) {
      await tx.contractMatch.updateMany({
        where: { id: { in: pending.map(t => t.id) }, status: "PENDING_ANALYSIS" },
        data: { status: "PROCESSING" },
      });
    }

    return pending;
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
