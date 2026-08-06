import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { startSodaIngestCron } from './cron/sodaIngest';
import { startStuckTasksMonitor } from './cron/stuckTasks';

import pinoHttp from 'pino-http';

import { prisma } from '@pliegonaut/database';

import { AppError } from './lib/errors';
import { createLogger } from './lib/logger';
import { createWsServer } from './lib/wsServer';

import healthRoutes from './routes/health';
import companiesRoutes from './routes/companies';
import contractsRoutes from './routes/contracts';
import scannerRoutes from './routes/scanner';
import workerRoutes from './routes/worker';

const logger = createLogger('pliegonaut-api');

const app = express();
const port = parseInt(process.env.PORT || '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 * * * *';

app.locals.logger = logger;

// Seguridad
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Logging
app.use(pinoHttp({ logger }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en 15 minutos.' },
});
app.use('/api/', limiter);

// Rutas
app.use(healthRoutes);
app.use(companiesRoutes);
app.use(contractsRoutes);
app.use(scannerRoutes);
app.use(workerRoutes);

// Cron de ingestión incremental SECOP II (Fase 1.1)
startSodaIngestCron();

// Monitor de tareas estancadas
startStuckTasksMonitor();

// === MANEJO DE ERRORES GLOBAL ===
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'JSON mal formado en el cuerpo de la solicitud' });
  }

  logger.error({ err, stack: err.stack }, '[UNHANDLED] Error no capturado');
  res.status(500).json({ error: 'Error interno del servidor' });
});

// === INICIO DEL SERVIDOR ===
const server = app.listen(port, () => {
  logger.info({ port, corsOrigin: CORS_ORIGIN, cronSchedule: CRON_SCHEDULE }, 'PliegoNaut API iniciada');
});

// WebSocket server para notificaciones al worker
createWsServer(server, logger);

// Graceful shutdown
function shutdown(signal: string) {
  logger.info({ signal }, 'Recibida señal de terminación');
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Servidor detenido correctamente');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forzando salida por timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Errores no capturados
process.on('uncaughtException', (err) => {
  logger.error({ err }, '[UNCAUGHT] Excepción no capturada');
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, '[UNHANDLED] Promesa rechazada no capturada');
});
