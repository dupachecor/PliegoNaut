import cron from 'node-cron';
import { prisma } from '@pliegonaut/database';
import pino from 'pino';

const logger = pino({ name: 'StuckTasksMonitor' });

export function startStuckTasksMonitor() {
  // Ejecutar cada hora: '0 * * * *'
  cron.schedule('0 * * * *', async () => {
    logger.info('Iniciando escaneo de tareas (ContractMatch) estancadas...');
    
    try {
      // Calcular la fecha límite: hace 1 hora
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      // Buscar tareas en estado PROCESSING que lleven más de 1 hora sin actualizarse
      const stuckTasks = await prisma.contractMatch.findMany({
        where: {
          status: 'PROCESSING',
          updatedAt: {
            lt: oneHourAgo,
          },
        },
        select: { id: true, secopId: true }
      });

      if (stuckTasks.length === 0) {
        logger.info('No se encontraron tareas estancadas.');
        return;
      }

      logger.warn(`Se encontraron ${stuckTasks.length} tareas estancadas. Devolviendo a PENDING_ANALYSIS.`);

      const ids = stuckTasks.map(t => t.id);

      // Actualizar los estados de nuevo a PENDING_ANALYSIS
      const result = await prisma.contractMatch.updateMany({
        where: {
          id: { in: ids }
        },
        data: {
          status: 'PENDING_ANALYSIS',
          updatedAt: new Date() // Refrescar el updatedAt para reiniciar el ciclo
        }
      });

      logger.info(`Se resetearon exitosamente ${result.count} tareas.`);
      
    } catch (error) {
      logger.error({ err: error }, 'Error al intentar reiniciar las tareas estancadas.');
    }
  });
  
  logger.info('Monitor de tareas estancadas iniciado (ejecutando cada hora).');
}
