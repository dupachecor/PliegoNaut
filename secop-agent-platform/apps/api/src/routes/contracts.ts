import { Router } from 'express';
import { prisma } from '@pliegonaut/database';
import { requireApiKey } from '../middleware/auth';

const router = Router();

router.get('/api/contracts/:companyId', requireApiKey, async (req, res) => {
  const { companyId } = req.params;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const skip = (page - 1) * limit;

  // Filters
  const search = req.query.search as string | undefined;
  const status = req.query.status as string | undefined;
  const minBudget = req.query.minBudget ? parseFloat(req.query.minBudget as string) : undefined;
  const maxBudget = req.query.maxBudget ? parseFloat(req.query.maxBudget as string) : undefined;
  const department = req.query.department as string | undefined;
  const municipio = req.query.municipio as string | undefined;
  const viableOnly = req.query.viableOnly === 'true';
  const closingSoon = req.query.closingSoon === 'true';

  const where: any = { companyId };

  if (search) {
    where.OR = [
      { title: { contains: search } },
      { entity: { contains: search } },
      { secopId: { contains: search } },
    ];
  }

  if (status) {
    where.status = status;
  }

  if (minBudget !== undefined) {
    where.budget = { ...where.budget, gte: minBudget };
  }
  if (maxBudget !== undefined) {
    where.budget = { ...where.budget, lte: maxBudget };
  }

  if (department) {
    where.department = { contains: department };
  }

  if (municipio) {
    where.region = { contains: municipio };
  }

  if (viableOnly) {
    where.status = 'VIABLE';
    where.viabilityScore = { gte: 50 };
  }

  if (closingSoon) {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    where.closingDate = { lte: sevenDaysFromNow, gte: new Date() };
  }

  const [contracts, total] = await Promise.all([
    prisma.contractMatch.findMany({
      where,
      orderBy: [{ matchScore: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.contractMatch.count({ where }),
  ]);

  // Analytics summary
  const stats = await prisma.contractMatch.groupBy({
    by: ['status'],
    where: { companyId },
    _count: true,
  });

  const summary = {
    total,
    pending: stats.find(s => s.status === 'PENDING_ANALYSIS')?._count || 0,
    processing: stats.find(s => s.status === 'PROCESSING')?._count || 0,
    viable: stats.find(s => s.status === 'VIABLE')?._count || 0,
    rejected: stats.find(s => s.status === 'REJECTED')?._count || 0,
  };

  res.json({ data: contracts, total, page, limit, pages: Math.ceil(total / limit), summary });
});

// Get single contract detail
router.get('/api/contracts/detail/:id', requireApiKey, async (req, res) => {
  const contract = await prisma.contractMatch.findUnique({
    where: { id: req.params.id },
    include: { company: true },
  });
  if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });
  res.json(contract);
});

// Get unique departments for filter dropdown
router.get('/api/contracts/:companyId/departments', requireApiKey, async (req, res) => {
  const departments = await prisma.contractMatch.findMany({
    where: { companyId: req.params.companyId, department: { not: '' } },
    select: { department: true },
    distinct: ['department'],
  });
  res.json(departments.map(d => d.department).sort());
});

// Get locations: departments with their municipalities (for cascading dropdowns)
router.get('/api/contracts/:companyId/locations', requireApiKey, async (req, res) => {
  const departmentFilter = req.query.department as string | undefined;

  const where: any = {
    companyId: req.params.companyId,
    department: { not: '' },
  };
  if (departmentFilter) {
    where.department = { contains: departmentFilter };
  }

  const rows = await prisma.contractMatch.findMany({
    where,
    select: { department: true, region: true },
    distinct: ['department', 'region'],
  });

  // Agrupar municipios por departamento
  const grouped: Record<string, Set<string>> = {};
  for (const row of rows) {
    if (!row.department) continue;
    if (!grouped[row.department]) grouped[row.department] = new Set();
    if (row.region) grouped[row.department].add(row.region);
  }

  const locations = Object.entries(grouped)
    .map(([department, municipios]) => ({
      department,
      municipios: Array.from(municipios).sort(),
    }))
    .sort((a, b) => a.department.localeCompare(b.department));

  res.json(locations);
});

// Get municipalities for a specific department
router.get('/api/contracts/:companyId/municipios', requireApiKey, async (req, res) => {
  const department = req.query.department as string | undefined;

  const where: any = {
    companyId: req.params.companyId,
    region: { not: '' },
  };
  if (department) {
    where.department = { contains: department };
  }

  const municipios = await prisma.contractMatch.findMany({
    where,
    select: { region: true },
    distinct: ['region'],
  });

  res.json(municipios.map(m => m.region).sort());
});

export default router;
