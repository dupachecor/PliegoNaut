// ===== Cron VORTAL: detección de nuevos procesos cada 15 min (Fase 2.1) =====
import cron from 'node-cron';
import { runVortalScrape } from '../services/vortalScraperService';
import { createLogger } from '../lib/logger';
import { VORTAL_CRON_SCHEDULE } from '../config/vortal';

const logger = createLogger('VortalScraper');

let running = false;

export function startVortalScraperCron() {
  cron.schedule(VORTAL_CRON_SCHEDULE, async () => {
    if (running) {
      logger.warn('[VORTAL] Ejecución anterior aún en curso; omitiendo tick');
      return;
    }
    running = true;
    try {
      const r = await runVortalScrape(logger);
      if (r.fallback) {
        logger.warn('[VORTAL] Fallback activo - datos provistos por ingestión SODA (datos.gov.co)');
        return;
      }
      logger.info(
        `[VORTAL] tick: nuevos=${r.nuevos} vistos=${r.vistos} docs=${r.documentos} blocked=${r.blocked} ok=${r.ok} ` +
        `${r.error ? '| error=' + r.error : ''}`,
      );
    } catch (err) {
      logger.error({ err }, '[VORTAL] Error en cron');
    } finally {
      running = false;
    }
  });
  logger.info(`[VORTAL] Cron programado (${VORTAL_CRON_SCHEDULE})`);
}
