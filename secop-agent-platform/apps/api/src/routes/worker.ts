import { Router } from 'express';
import { prisma } from '@pliegonaut/database';

import { requireWorkerKey } from '../middleware/auth';
import { validate, analysisSchema } from '../middleware/validate';

const router = Router();

// Worker task polling
router.get('/api/worker/tasks', requireWorkerKey, async (_req, res) => {
  const pendingTasks = await prisma.contractMatch.findMany({
    where: { status: "PENDING_ANALYSIS" },
    include: { company: true },
    take: 5,
    orderBy: { createdAt: 'asc' },
  });

  const ids = pendingTasks.map((t) => t.id);
  if (ids.length > 0) {
    await prisma.contractMatch.updateMany({
      where: { id: { in: ids }, status: "PENDING_ANALYSIS" },
      data: { status: "PROCESSING" },
    });
  }

  res.json(pendingTasks);
});

// Worker analysis submission
router.patch('/api/worker/tasks/:id/analysis', requireWorkerKey, validate(analysisSchema), async (req, res) => {
  const { id } = req.params;
  const { status, viabilityScore, reportLegal, reportFinancial, reportFinal } = req.body;

  const existing = await prisma.contractMatch.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: 'Contrato no encontrado' });
  }
  if (existing.status !== "PROCESSING") {
    return res.status(409).json({ error: `El contrato ya fue procesado (estado: ${existing.status})` });
  }

  const updated = await prisma.contractMatch.update({
    where: { id },
    data: { status, viabilityScore, reportLegal, reportFinancial, reportFinal },
  });

  res.json(updated);
});

// Worker health check (for Docker compose health checks)
router.get('/api/worker/health', async (_req, res) => {
  res.json({ status: 'ok', service: 'api' });
});

export default router;
