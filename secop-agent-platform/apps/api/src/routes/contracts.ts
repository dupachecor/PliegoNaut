import { Router } from 'express';
import { prisma } from '@pliegonaut/database';

const router = Router();

router.get('/api/contracts/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const skip = (page - 1) * limit;

  const [contracts, total] = await Promise.all([
    prisma.contractMatch.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.contractMatch.count({ where: { companyId } }),
  ]);

  res.json({ data: contracts, total, page, limit, pages: Math.ceil(total / limit) });
});

export default router;
