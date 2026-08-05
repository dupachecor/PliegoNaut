import { Router } from 'express';
import { prisma } from '@pliegonaut/database';
import { requireApiKey } from '../middleware/auth';
import { validate, companySchema } from '../middleware/validate';

const router = Router();

router.get('/api/companies', async (_req, res) => {
  const companies = await prisma.company.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(companies);
});

router.post('/api/companies', requireApiKey, validate(companySchema), async (req, res) => {
  try {
    const newCompany = await prisma.company.create({ data: req.body });
    res.status(201).json(newCompany);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe una empresa con ese NIT' });
    }
    throw error;
  }
});

export default router;
