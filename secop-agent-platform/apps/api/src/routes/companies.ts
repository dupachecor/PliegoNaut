import { Router } from 'express';
import { prisma } from '@pliegonaut/database';
import { requireApiKey } from '../middleware/auth';
import { validate, companySchema } from '../middleware/validate';

const router = Router();

router.get('/api/companies', requireApiKey, async (_req, res) => {
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

router.get('/api/companies/:id', requireApiKey, async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
  });
  if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });
  res.json(company);
});

router.put('/api/companies/:id', requireApiKey, validate(companySchema), async (req, res) => {
  try {
    const updated = await prisma.company.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(updated);
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe una empresa con ese NIT' });
    }
    throw error;
  }
});

router.delete('/api/companies/:id', requireApiKey, async (req, res) => {
  try {
    await prisma.company.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }
    throw error;
  }
});

export default router;
