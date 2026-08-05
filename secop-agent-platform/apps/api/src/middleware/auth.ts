import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

const API_KEY = process.env.API_KEY || 'dev-key-change-in-production'
const WORKER_API_KEY = process.env.WORKER_API_KEY || 'worker-dev-key-change'

function constantTimeCompare(actual: string, expected: string): boolean {
  const actualBuf = Buffer.from(actual)
  const expectedBuf = Buffer.from(expected)
  if (actualBuf.length !== expectedBuf.length) {
    crypto.timingSafeEqual(actualBuf, actualBuf)
    return false
  }
  return crypto.timingSafeEqual(actualBuf, expectedBuf)
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req)
  if (!token) {
    return res.status(401).json({ error: 'Token de autenticación requerido' })
  }
  if (!constantTimeCompare(token, API_KEY)) {
    return res.status(403).json({ error: 'Token inválido' })
  }
  next()
}

export function requireWorkerKey(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req)
  if (!token) {
    return res.status(401).json({ error: 'Token de worker requerido' })
  }
  if (!constantTimeCompare(token, WORKER_API_KEY)) {
    return res.status(403).json({ error: 'Token de worker inválido' })
  }
  next()
}
