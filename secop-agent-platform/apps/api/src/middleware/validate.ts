import { Request, Response, NextFunction } from 'express'
import { z, ZodSchema } from 'zod'

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: result.error.flatten().fieldErrors,
      })
    }
    req.body = result.data
    next()
  }
}

export const companySchema = z.object({
  name: z.string().min(1, 'Nombre requerido'),
  nit: z.string().min(1, 'NIT requerido'),
  workingCapital: z.number().nonnegative(),
  liquidity: z.number().nonnegative(),
  unspscCodes: z.string().min(1),
  regions: z.string().optional().default(''),
  emails: z.string().optional().default(''),
  certifications: z.string().optional().default('[]'),
  description: z.string().optional().default(''),
  website: z.string().optional().default(''),
  minBudget: z.number().nonnegative().optional().default(0),
  maxBudget: z.number().nonnegative().optional().default(9999999999),
})

export const companyUpdateSchema = z.object({
  name: z.string().min(1, 'Nombre requerido').optional(),
  nit: z.string().min(1, 'NIT requerido').optional(),
  workingCapital: z.number().nonnegative().optional(),
  liquidity: z.number().nonnegative().optional(),
  unspscCodes: z.string().min(1).optional(),
  regions: z.string().optional(),
  emails: z.string().optional(),
  certifications: z.string().optional(),
  description: z.string().optional(),
  website: z.string().optional(),
  minBudget: z.number().nonnegative().optional(),
  maxBudget: z.number().nonnegative().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Debe enviar al menos un campo para actualizar',
})

export const analysisSchema = z.object({
  status: z.enum(['VIABLE', 'REJECTED', 'ERROR']),
  viabilityScore: z.number().int().min(0).max(100),
  reportLegal: z.string().optional(),
  reportFinancial: z.string().optional(),
  reportFinal: z.string().optional(),
  presentationRoute: z.string().optional(),
  errorMessage: z.string().optional(),
})

export const searchSchema = z.object({
  unspscCodes: z.array(z.string()).optional(),
  minBudget: z.number().optional(),
  maxBudget: z.number().optional(),
  department: z.string().optional(),
  municipio: z.string().optional(),
  status: z.array(z.string()).optional(),
  searchText: z.string().optional(),
})
