export type CompanyStatus = 'PENDING_ANALYSIS' | 'PROCESSING' | 'VIABLE' | 'REJECTED' | 'ERROR'

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
  description: string
  website: string
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
  phase: string
  contractStatus: string
  department: string
  region: string
  categoryCode: string
  categoryName: string
  contactName: string
  contactPhone: string
  contactEmail: string
  estimatedDuration: string
  publishedAt: string | null
  closingDate: string | null
  presentationDeadline: string | null
  matchScore: number
  viabilityScore: number | null
  presentationRoute: string | null
  reportLegal: string | null
  reportFinancial: string | null
  reportFinal: string | null
  errorMessage: string
  retryCount: number
  source?: string
  awarded?: boolean
  awardedProveedor?: string
  valorAdjudicado?: number | null
  rawSodaData: string
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
  summary?: {
    total: number
    pending: number
    processing: number
    viable: number
    rejected: number
  }
}

export interface AnalysisInput {
  status: 'VIABLE' | 'REJECTED' | 'ERROR'
  viabilityScore: number
  reportLegal?: string
  reportFinancial?: string
  reportFinal?: string
  presentationRoute?: string
  errorMessage?: string
}

export interface PresentationStep {
  step: number
  title: string
  description: string
  deadline: string
  status: 'pending' | 'completed' | 'current'
  documents: string[]
}

export interface PresentationRoute {
  steps: PresentationStep[]
  totalDays: number
  criticalDate: string
  summary: string
}

export interface ContractFilters {
  search?: string
  status?: string
  minBudget?: number
  maxBudget?: number
  department?: string
  municipio?: string
  closingSoon?: boolean
  viableOnly?: boolean
}

export interface LocationGroup {
  department: string
  municipios: string[]
}

export interface UserProfile {
  id: string
  email: string
  name: string
  role: string
  companyId?: string
  company?: Company
}

export interface WorkerStatus {
  isRunning: boolean
  tasksPending: number
  lastPoll: string
}
