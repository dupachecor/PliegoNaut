export type CompanyStatus = 'PENDING_ANALYSIS' | 'PROCESSING' | 'VIABLE' | 'REJECTED'

export interface Company {
  id: string
  name: string
  nit: string
  workingCapital: number
  liquidity: number
  unspscCodes: string
  regions: string
  emails: string
  minBudget: number
  maxBudget: number
  certifications: string
  createdAt: string
  updatedAt: string
}

export interface ContractMatch {
  id: string
  companyId: string
  secopId: string
  entity: string
  title: string
  budget: number
  urlPliego: string
  status: CompanyStatus
  viabilityScore: number | null
  reportLegal: string | null
  reportFinancial: string | null
  reportFinal: string | null
  notified: boolean
  createdAt: string
  updatedAt: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  pages: number
}

export interface AnalysisInput {
  status: 'VIABLE' | 'REJECTED'
  viabilityScore: number
  reportLegal?: string
  reportFinancial?: string
  reportFinal?: string
}

export interface WorkerStatus {
  isRunning: boolean
}
