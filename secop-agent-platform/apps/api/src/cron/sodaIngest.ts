import cron from 'node-cron';
import { runIncrementalSodaIngest } from '../services/sodaIngestService';
import { broadcastNewTask } from '../lib/wsServer';
import { createLogger } from '../lib/logger';
import { sendAlert } from '../lib/alert';

const logger = createLogger('SodaIngest');

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 * * * *';
const MAX_CONSECUTIVE_FAILURES = 3;

let consecutiveFailures = 0;

export async function runSodaIngestOnce(log: typeof logger = logger) {
  try {
    const result = await runIncrementalSodaIngest({
      info: (msg: string, ...args: any[]) => log.info(msg, ...args),
      error: (msg: string, ...args: any[]) => log.error(msg, ...args),
    });
    consecutiveFailures = 0;

    if (result.nuevos > 0) {
      broadcastNewTask();
    }
    return result;
  } catch (err: any) {
    consecutiveFailures += 1;
    log.error({ err }, `[INGEST] Error en ejecución (fallo consecutivo #${consecutiveFailures})`);
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      log.error(
        `[INGEST] ALERTA: ${consecutiveFailures} ingestas consecutivas fallaron. ` +
        'Revisa rate-limit, credenciales SODA o conectividad.'
      );
      await sendAlert(
        `⚠️ PliegoNaut: ${consecutiveFailures} ingestas SECOP consecutivas fallaron`,
        { error: err?.message || String(err) }
      );
    }
    throw err;
  }
}

export function startSodaIngestCron() {
  cron.schedule(CRON_SCHEDULE, async () => {
    logger.info('[INGEST] Cron: iniciando ingestión incremental SECOP II');
    await runSodaIngestOnce();
  });
  logger.info(`[INGEST] Cron de ingestión programado (${CRON_SCHEDULE}), fallos para alerta: ${MAX_CONSECUTIVE_FAILURES}`);
}
