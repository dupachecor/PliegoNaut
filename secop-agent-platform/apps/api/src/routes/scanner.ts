import { Router } from 'express';
import { runDailySecopScanner } from '../services/sodaScanner';
import { broadcastNewTask } from '../lib/wsServer';
import type { Logger } from 'pino';

const router = Router();

router.post('/api/trigger-scanner', (req, res) => {
  const logger = req.app.locals.logger as Logger;
  logger.info('[SCANNER] Trigger manual');

  runDailySecopScanner({
    info: (msg: string, ...args: any[]) => logger.info({ source: 'soda' }, msg, ...args),
    error: (msg: string, ...args: any[]) => logger.error({ source: 'soda' }, msg, ...args),
  }).then(() => {
    broadcastNewTask();
  }).catch((err) => {
    logger.error({ err }, '[SCANNER] Error en trigger manual');
  });

  res.json({ message: 'Escaneo SODA iniciado en background' });
});

export default router;
