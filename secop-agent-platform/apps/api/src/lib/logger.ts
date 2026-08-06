import pino from 'pino';

const LOG_FILE = process.env.LOG_FILE || '/tmp/pliegonaut-api.log';

// Logger compartido: escribe a stdout (pretty en dev, JSON en prod) Y al archivo
// de logs (default /tmp/pliegonaut-api.log). En modo test evita transports
// (worker threads) para no interferir con Vitest.
export function createLogger(name?: string) {
  const level = process.env.LOG_LEVEL || 'info';

  if (process.env.NODE_ENV === 'test') {
    return pino({ name, level });
  }

  const streams: pino.StreamEntry[] = [];
  if (process.env.NODE_ENV === 'development') {
    streams.push({ stream: pino.transport({ target: 'pino-pretty', options: { colorize: true } }) });
  } else {
    streams.push({ stream: process.stdout });
  }
  streams.push({ stream: pino.destination({ dest: LOG_FILE, append: true, mkdir: true }) });

  return pino({ name, level }, pino.multistream(streams));
}
