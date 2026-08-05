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
  minBudget: z.number().nonnegative().optional().default(0),
  maxBudget: z.number().nonnegative().optional().default(9999999999),
})

export const analysisSchema = z.object({
  status: z.enum(['VIABLE', 'REJECTED']),
  viabilityScore: z.number().int().min(0).max(100),
  reportLegal: z.string().optional(),
  reportFinancial: z.string().optional(),
  reportFinal: z.string().optional(),
})
