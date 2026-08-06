import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockClient = vi.hoisted(() => ({ get: vi.fn(), defaults: {} }))
const mockAxios = vi.hoisted(() => {
  const configs: any[] = []
  return {
    get: vi.fn(),
    configs,
    create: vi.fn((cfg: any) => {
      configs.push(cfg)
      return mockClient
    }),
  }
})
const mockPrisma = vi.hoisted(() => ({
  ingestLog: { findUnique: vi.fn(), upsert: vi.fn() },
  company: { findMany: vi.fn() },
  contractMatch: { findMany: vi.fn(), createMany: vi.fn() },
}))

vi.hoisted(() => {
  process.env.SOCRATA_APP_TOKEN = 'test-app-token'
})

vi.mock('axios', () => ({ default: mockAxios }))
vi.mock('axios-retry', () => ({ default: vi.fn() }))
vi.mock('@pliegonaut/database', () => ({ prisma: mockPrisma, default: mockPrisma }))

import { runIncrementalSodaIngest, datasetIdFromUrl } from '../services/sodaIngestService'

const P6DX_URL = 'https://www.datos.gov.co/resource/p6dx-8zbt.json'
const F789_URL = 'https://www.datos.gov.co/resource/f789-7hwg.json'
const RPMR_URL = 'https://www.datos.gov.co/resource/rpmr-utcd.json'
const JBJY_URL = 'https://www.datos.gov.co/resource/jbjy-vk9h.json'

const BOOTSTRAP_DAYS = 7
const quietLogger = { info: () => {}, error: () => {} }

const company = {
  id: 'c1',
  name: 'Empresa A',
  nit: '1',
  workingCapital: 100,
  liquidity: 1.5,
  minBudget: 0,
  maxBudget: 1e10,
  unspscCodes: '81111800',
  regions: 'Cundinamarca',
  certifications: '[]',
}

let dataByUrl: Record<string, any[]> = {}

function makeRecord(id: string, opts: Partial<any> = {}): any {
  return {
    id_del_proceso: id,
    entidad: 'Entidad Test',
    descripci_n_del_procedimiento: 'Objeto de prueba',
    precio_base: '5000000',
    departamento_entidad: 'Cundinamarca',
    ciudad_entidad: 'Bogotá',
    estado_del_procedimiento: 'Convocado',
    codigo_principal_de_categoria: 'V1.81111800',
    fecha_de_ultima_publicaci: '2026-08-03T00:00:00.000',
    fecha_de_publicacion_del: '2026-08-02T00:00:00.000',
    fase: 'Presentación de oferta',
    urlproceso: { url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.1' },
    ...opts,
  }
}

function makeSecop1Record(id: string, opts: Partial<any> = {}): any {
  return {
    numero_de_proceso: id,
    numero_de_contrato: id,
    nombre_entidad: 'ALCALDÍA MUNICIPIO TEST',
    departamento_entidad: 'Cundinamarca',
    municipio_entidad: 'Facatativá',
    objeto_a_contratar: 'Objeto de alcaldía',
    estado_del_proceso: 'Convocado',
    cuantia_proceso: '8000000',
    modalidad_de_contratacion: 'Selección abreviada',
    fecha_de_cargue_en_el_secop: '2026-08-04T00:00:00.000',
    ruta_proceso_en_secop_i: { url: 'https://www.contratos.gov.co/consultas/detalleProceso.do?numConstancia=19-12-123' },
    ...opts,
  }
}

function makeContract(portafolio: string, opts: Partial<any> = {}): any {
  return {
    proceso_de_compra: portafolio,
    proveedor_adjudicado: 'ACME SAS',
    valor_del_contrato: '15000000',
    fecha_de_firma: '2026-08-03T00:00:00.000',
    ...opts,
  }
}

function makeSecopIntegradoRecord(id: string, opts: Partial<any> = {}): any {
  return {
    numero_de_proceso: id,
    numero_del_contrato: id,
    nombre_de_la_entidad: 'ALCALDÍA INTEGRADO TEST',
    departamento_entidad: 'Cundinamarca',
    municipio_entidad: 'Zipaquirá',
    estado_del_proceso: 'Convocado',
    modalidad_de_contrataci_n: 'Selección abreviada',
    objeto_del_proceso: 'Objeto integrado',
    valor_contrato: '12000000',
    url_contrato: 'https://www.contratos.gov.co/consultas/detalleProceso.do?numConstancia=25-12-999',
    fecha_de_firma_del_contrato: null,
    ...opts,
  }
}

describe('datasetIdFromUrl', () => {
  it('extrae el id del dataset de la URL', () => {
    expect(datasetIdFromUrl(P6DX_URL)).toBe('p6dx-8zbt')
    expect(datasetIdFromUrl(F789_URL)).toBe('f789-7hwg')
    expect(datasetIdFromUrl('url-invalida')).toBe('unknown')
  })
})

describe('runIncrementalSodaIngest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dataByUrl = {}
    mockClient.get.mockImplementation(async (url: string) => ({ data: dataByUrl[url] ?? [] }))
    mockPrisma.ingestLog.findUnique.mockResolvedValue(null)
    mockPrisma.ingestLog.upsert.mockResolvedValue({ id: '1', datasetId: 'p6dx-8zbt' })
    mockPrisma.company.findMany.mockResolvedValue([])
    mockPrisma.contractMatch.createMany.mockResolvedValue({ count: 0 })
  })

  it('usa watermark bootstrap de N días cuando no existe IngestLog', async () => {
    await runIncrementalSodaIngest(quietLogger)

    const params = mockClient.get.mock.calls[0][1].params
    expect(params).toMatchObject({
      $order: 'fecha_de_ultima_publicaci DESC',
      $limit: 1000,
      $offset: 0,
    })

    expect(params.$where).toMatch(/^fecha_de_ultima_publicaci >= '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}'$/)
    const stamp = params.$where.match(/'([^']+)'/)[1] + 'Z'
    const ts = Date.parse(stamp)
    expect(Math.abs(ts - (Date.now() - BOOTSTRAP_DAYS * 24 * 60 * 60 * 1000))).toBeLessThan(2000)

    expect(mockPrisma.ingestLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { datasetId: 'p6dx-8zbt' },
        create: expect.objectContaining({ status: 'OK', recordsFetched: 0 }),
      }),
    )
  })

  it('usa la marca de agua persistida cuando existe IngestLog', async () => {
    const persisted = new Date('2026-08-04T00:00:00.000Z')
    mockPrisma.ingestLog.findUnique.mockResolvedValue({ datasetId: 'p6dx-8zbt', lastSeenPub: persisted })

    await runIncrementalSodaIngest(quietLogger)

    expect(mockClient.get.mock.calls[0][1].params.$where).toBe("fecha_de_ultima_publicaci >= '2026-08-04T00:00:00.000'")
  })

  it('pagina con $offset y avanza el watermark al máximo visto', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => makeRecord(`CO1.PG.${i}`))
    const page2 = [makeRecord('CO1.PG.1000', { fecha_de_ultima_publicaci: '2026-08-02T00:00:00.000' })]

    let p6dxCalls = 0
    mockClient.get.mockImplementation(async (url: string) => {
      if (url === P6DX_URL) {
        p6dxCalls++
        if (p6dxCalls === 1) return { data: page1 }
        if (p6dxCalls === 2) return { data: page2 }
      }
      return { data: [] }
    })

    const result = await runIncrementalSodaIngest(quietLogger)

    expect(mockClient.get.mock.calls[1][1].params).toMatchObject({ $offset: 1000 })
    expect(result.records).toBe(1001)
    expect(mockPrisma.ingestLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { datasetId: 'p6dx-8zbt' },
        update: expect.objectContaining({ lastSeenPub: new Date('2026-08-03T00:00:00.000Z') }),
      }),
    )
  })

  it('dedup por id_del_proceso y solo persiste matches de empresas (SECOP II)', async () => {
    mockPrisma.company.findMany.mockResolvedValue([company])
    mockPrisma.contractMatch.findMany.mockResolvedValue([])

    dataByUrl[P6DX_URL] = [
      makeRecord('DUP.1'),
      makeRecord('DUP.1'), // duplicado
      makeRecord('DUP.2', { codigo_principal_de_categoria: 'X1.99999999' }), // no matchea UNSPSC
      makeRecord('DUP.3', { departamento_entidad: 'Antioquia' }), // no matchea región
      makeRecord('DUP.4', { estado_del_procedimiento: 'Seleccionado' }), // no matchea estado
      makeRecord('DUP.5', { precio_base: '999999999999' }), // excede maxBudget
    ]

    const result = await runIncrementalSodaIngest(quietLogger)

    expect(result.records).toBe(5)
    expect(mockPrisma.contractMatch.createMany).toHaveBeenCalledTimes(1)
    const created = mockPrisma.contractMatch.createMany.mock.calls[0][0].data
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ secopId: 'DUP.1', companyId: 'c1', status: 'PENDING_ANALYSIS', source: 'secop_ii', awarded: false })
  })

  it('ingesta SECOP I (alcaldías) con source secop_i_procesos y excluye no convocados', async () => {
    mockPrisma.company.findMany.mockResolvedValue([company])
    mockPrisma.contractMatch.findMany.mockResolvedValue([])

    dataByUrl[F789_URL] = [
      makeSecop1Record('SEC1.1'),
      makeSecop1Record('SEC1.2', { estado_del_proceso: 'Celebrado' }), // adjudicado: se descarta
      makeSecop1Record('SEC1.3', { departamento_entidad: 'Antioquia' }), // no matchea región
    ]

    const result = await runIncrementalSodaIngest(quietLogger)

    // 2 convocados normalizados (SEC1.1 y SEC1.3); solo SEC1.1 matchea la empresa
    expect(result.records).toBe(2)
    const created = mockPrisma.contractMatch.createMany.mock.calls[0][0].data
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      secopId: 'SEC1.1',
      source: 'secop_i_procesos',
      entity: 'ALCALDÍA MUNICIPIO TEST',
      department: 'Cundinamarca',
      budget: 8000000,
      urlPliego: 'https://www.contratos.gov.co/consultas/detalleProceso.do?numConstancia=19-12-123',
    })
  })

  it('dedup cross-fuente: SECOP II tiene prioridad sobre SECOP I', async () => {
    mockPrisma.company.findMany.mockResolvedValue([company])
    mockPrisma.contractMatch.findMany.mockResolvedValue([])

    dataByUrl[P6DX_URL] = [makeRecord('CO1.REQ.DUP')]
    dataByUrl[F789_URL] = [makeSecop1Record('CO1.REQ.DUP', { nombre_entidad: 'ALCALDÍA DUP' })]

    const result = await runIncrementalSodaIngest(quietLogger)

    expect(result.records).toBe(1)
    const created = mockPrisma.contractMatch.createMany.mock.calls[0][0].data
    expect(created).toHaveLength(1)
    expect(created[0].source).toBe('secop_ii')
  })

  it('ingesta SECOP Integrado (rpmr-utcd) con $where CONVOCADO y source secop_i_integrado', async () => {
    mockPrisma.company.findMany.mockResolvedValue([company])
    mockPrisma.contractMatch.findMany.mockResolvedValue([])

    dataByUrl[RPMR_URL] = [
      makeSecopIntegradoRecord('INT.1'),
      makeSecopIntegradoRecord('INT.2', { estado_del_proceso: 'Celebrado' }), // adjudicado: se descarta
      makeSecopIntegradoRecord('INT.3', { departamento_entidad: 'Antioquia' }), // no matchea región
    ]

    const result = await runIncrementalSodaIngest(quietLogger)

    // INT.1 e INT.3 se normalizan; INT.2 (no Convocado) se descarta
    expect(result.records).toBe(2)

    // La fuente usa un $where fijo por estado (no por fecha/watermark)
    const rpmrCalls = mockClient.get.mock.calls.filter((c: any) => (c[0] as string).includes('rpmr-utcd'))
    expect(rpmrCalls.length).toBeGreaterThan(0)
    expect(rpmrCalls[0][1].params.$where).toBe("upper(estado_del_proceso) = 'CONVOCADO'")
    expect(rpmrCalls[0][1].params.$order).toBeUndefined()

    const created = mockPrisma.contractMatch.createMany.mock.calls[0][0].data
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      secopId: 'INT.1',
      source: 'secop_i_integrado',
      entity: 'ALCALDÍA INTEGRADO TEST',
      department: 'Cundinamarca',
      budget: 12000000,
      urlPliego: 'https://www.contratos.gov.co/consultas/detalleProceso.do?numConstancia=25-12-999',
    })
  })

  it('dedup cross-fuente: secop_i_integrado tiene la menor prioridad', async () => {
    mockPrisma.company.findMany.mockResolvedValue([company])
    mockPrisma.contractMatch.findMany.mockResolvedValue([])

    dataByUrl[P6DX_URL] = [makeRecord('CO1.TRIPLE')]
    dataByUrl[F789_URL] = [makeSecop1Record('CO1.TRIPLE', { nombre_entidad: 'ALCALDÍA F789' })]
    dataByUrl[RPMR_URL] = [makeSecopIntegradoRecord('CO1.TRIPLE', { nombre_de_la_entidad: 'ALCALDÍA INTEGRADO' })]

    const result = await runIncrementalSodaIngest(quietLogger)

    expect(result.records).toBe(1)
    const created = mockPrisma.contractMatch.createMany.mock.calls[0][0].data
    expect(created).toHaveLength(1)
    expect(created[0].source).toBe('secop_ii')
  })

  it('persiste un proceso integrado cuando ninguna otra fuente lo cubre', async () => {
    mockPrisma.company.findMany.mockResolvedValue([company])
    mockPrisma.contractMatch.findMany.mockResolvedValue([])

    dataByUrl[RPMR_URL] = [makeSecopIntegradoRecord('SOLO.INT')]

    const result = await runIncrementalSodaIngest(quietLogger)

    expect(result.records).toBe(1)
    const created = mockPrisma.contractMatch.createMany.mock.calls[0][0].data
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      secopId: 'SOLO.INT',
      source: 'secop_i_integrado',
      status: 'PENDING_ANALYSIS',
      awarded: false,
    })
  })

  it('enriquece procesos SECOP II con adjudicaciones de jbjy-vk9h', async () => {
    mockPrisma.company.findMany.mockResolvedValue([company])
    mockPrisma.contractMatch.findMany.mockResolvedValue([])

    dataByUrl[P6DX_URL] = [
      makeRecord('CO1.REQ.ADJ', { id_del_portafolio: 'CO1.BDOS.777' }),
      makeRecord('CO1.REQ.NOADJ', { id_del_portafolio: 'CO1.BDOS.999' }),
    ]
    dataByUrl[JBJY_URL] = [makeContract('CO1.BDOS.777')]

    const result = await runIncrementalSodaIngest(quietLogger)

    expect(result.records).toBe(2)
    const created = mockPrisma.contractMatch.createMany.mock.calls[0][0].data
    expect(created).toHaveLength(2)
    const adj = created.find((c: any) => c.secopId === 'CO1.REQ.ADJ')
    const noAdj = created.find((c: any) => c.secopId === 'CO1.REQ.NOADJ')
    expect(adj).toMatchObject({ awarded: true, awardedProveedor: 'ACME SAS', valorAdjudicado: 15000000 })
    expect(noAdj).toMatchObject({ awarded: false, awardedProveedor: '', valorAdjudicado: null })
  })

  it('registra IngestLog con status ERROR y re-lanza cuando TODAS las fuentes fallan', async () => {
    mockClient.get.mockImplementation(async () => { throw new Error('rate limited') })

    await expect(runIncrementalSodaIngest(quietLogger)).rejects.toThrow('rate limited')

    expect(mockPrisma.ingestLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { datasetId: 'p6dx-8zbt' },
        update: expect.objectContaining({ status: 'ERROR', errors: 'rate limited' }),
      }),
    )
  })

  it('no crea ContractMatch sin empresas y persiste IngestLog OK por dataset', async () => {
    dataByUrl[P6DX_URL] = [makeRecord('SOLO.1')]
    dataByUrl[F789_URL] = [makeSecop1Record('SOLO.2')]

    await runIncrementalSodaIngest(quietLogger)

    expect(mockPrisma.contractMatch.createMany).not.toHaveBeenCalled()
    expect(mockPrisma.ingestLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { datasetId: 'p6dx-8zbt' }, update: expect.objectContaining({ status: 'OK' }) }),
    )
    expect(mockPrisma.ingestLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { datasetId: 'f789-7hwg' }, update: expect.objectContaining({ status: 'OK' }) }),
    )
  })

  it('envía X-App-Token en el cliente SODA', () => {
    expect(mockAxios.configs.length).toBeGreaterThan(0)
    expect(mockAxios.configs[0].headers).toMatchObject({ 'X-App-Token': 'test-app-token' })
  })
})

describe('runIncrementalSodaIngest - truncamiento por MAX_PAGES', () => {
  it('avanza el watermark al mínimo visto cuando la ventana se corta', async () => {
    vi.resetModules()
    process.env.INGEST_PAGE_SIZE = '2'
    process.env.INGEST_MAX_PAGES = '2'

    const mod = await import('../services/sodaIngestService')
    mockPrisma.ingestLog.findUnique.mockResolvedValue(null)
    mockPrisma.company.findMany.mockResolvedValue([])
    mockPrisma.ingestLog.upsert.mockResolvedValue({ id: '1' })

    const records = [
      makeRecord('T.1', { fecha_de_ultima_publicaci: '2026-08-05T00:00:00.000' }),
      makeRecord('T.2', { fecha_de_ultima_publicaci: '2026-08-02T00:00:00.000' }),
    ]
    mockClient.get.mockImplementation(async (url: string) => {
      if (url === P6DX_URL) return { data: records }
      return { data: [] }
    })

    await mod.runIncrementalSodaIngest(quietLogger)

    expect(mockPrisma.ingestLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { datasetId: 'p6dx-8zbt' },
        update: expect.objectContaining({ lastSeenPub: new Date('2026-08-02T00:00:00.000Z') }),
      }),
    )

    delete process.env.INGEST_PAGE_SIZE
    delete process.env.INGEST_MAX_PAGES
  })
})
