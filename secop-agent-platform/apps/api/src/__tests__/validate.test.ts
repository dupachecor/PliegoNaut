import { describe, it, expect } from 'vitest'
import { companySchema, analysisSchema } from '../middleware/validate'

describe('companySchema', () => {
  it('acepta datos válidos', () => {
    const result = companySchema.safeParse({
      name: 'Empresa SAS',
      nit: '123456789',
      workingCapital: 100000,
      liquidity: 1.5,
      unspscCodes: '81111800,43211500',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza nombre vacío', () => {
    const result = companySchema.safeParse({
      name: '',
      nit: '123456789',
      workingCapital: 100000,
      liquidity: 1.5,
      unspscCodes: '81111800',
    })
    expect(result.success).toBe(false)
  })

  it('rechaza workingCapital negativo', () => {
    const result = companySchema.safeParse({
      name: 'Empresa SAS',
      nit: '123456789',
      workingCapital: -100,
      liquidity: 1.5,
      unspscCodes: '81111800',
    })
    expect(result.success).toBe(false)
  })

  it('asigna valores por defecto', () => {
    const result = companySchema.parse({
      name: 'Empresa SAS',
      nit: '123456789',
      workingCapital: 100000,
      liquidity: 1.5,
      unspscCodes: '81111800',
    })
    expect(result.regions).toBe('')
    expect(result.minBudget).toBe(0)
    expect(result.maxBudget).toBe(9999999999)
    expect(result.certifications).toBe('[]')
  })
})

describe('analysisSchema', () => {
  it('acepta VIABLE con score', () => {
    const result = analysisSchema.safeParse({
      status: 'VIABLE',
      viabilityScore: 85,
    })
    expect(result.success).toBe(true)
  })

  it('acepta REJECTED con reporte', () => {
    const result = analysisSchema.safeParse({
      status: 'REJECTED',
      viabilityScore: 30,
      reportFinal: 'No cumple requisitos',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza status inválido', () => {
    const result = analysisSchema.safeParse({
      status: 'INVALID',
      viabilityScore: 50,
    })
    expect(result.success).toBe(false)
  })

  it('rechaza score mayor a 100', () => {
    const result = analysisSchema.safeParse({
      status: 'VIABLE',
      viabilityScore: 150,
    })
    expect(result.success).toBe(false)
  })
})
