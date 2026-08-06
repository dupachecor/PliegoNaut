import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import type { Logger } from 'pino';
import { constantTimeCompare } from '../middleware/auth';

let wss: WebSocketServer | null = null;

const WORKER_API_KEY = process.env.WORKER_API_KEY;

function authenticate(req: IncomingMessage): boolean {
  if (!WORKER_API_KEY) return false;

  const url = new URL(req.url || '', 'http://localhost');
  const token = url.searchParams.get('token');
  if (token !== null && constantTimeCompare(token, WORKER_API_KEY)) return true;

  const auth = req.headers['authorization'] || '';
  const match = auth.match(/^Bearer\s+(.+)$/);
  return match ? constantTimeCompare(match[1], WORKER_API_KEY) : false;
}

function heartbeat(this: WebSocket) {
  (this as any).__alive = true;
}

export function createWsServer(server: HttpServer, logger: Logger) {
  wss = new WebSocketServer({ server, path: '/api/worker/stream' });

  wss.on('connection', (ws, req) => {
    if (!authenticate(req)) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    (ws as any).__alive = true;
    ws.on('pong', heartbeat);
    ws.send(JSON.stringify({ event: 'connected' }));

    logger.info('[WS] Worker conectado');
  });

  const interval = setInterval(() => {
    wss?.clients.forEach((ws) => {
      if ((ws as any).__alive === false) {
        logger.info('[WS] Worker sin respuesta, cerrando');
        return ws.terminate();
      }
      (ws as any).__alive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  logger.info('[WS] WebSocket server inicializado en /api/worker/stream');
  return wss;
}

export function broadcastNewTask() {
  if (!wss) return;
  const msg = JSON.stringify({ event: 'newTasks', timestamp: Date.now() });
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}
