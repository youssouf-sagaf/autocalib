type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel =
  (import.meta.env.VITE_LOG_LEVEL as LogLevel | undefined) ?? 'debug';

const LOG_BUFFER: string[] = [];
const FLUSH_INTERVAL_MS = 2000;
const MAX_BUFFER = 500;

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

function formatLine(level: LogLevel, tag: string, msg: string): string {
  return `${timestamp()} ${level.toUpperCase().padEnd(5)} [${tag}] ${msg}`;
}

async function flushToServer(): Promise<void> {
  if (LOG_BUFFER.length === 0) return;
  const batch = LOG_BUFFER.splice(0);
  try {
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    await fetch(`${baseUrl}/api/v1/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: batch }),
    });
  } catch {
    // Server unreachable — silently drop
  }
}

setInterval(flushToServer, FLUSH_INTERVAL_MS);

function log(level: LogLevel, tag: string, msg: string, ...args: unknown[]): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) return;

  const formatted = args.length > 0 ? `${msg} ${JSON.stringify(args)}` : msg;
  const line = formatLine(level, tag, formatted);

  // Console output (always, for DevTools)
  const consoleFn = level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : level === 'debug' ? console.debug
    : console.info;
  consoleFn(`[${tag}]`, msg, ...args);

  // Buffer for server flush
  LOG_BUFFER.push(line);
  if (LOG_BUFFER.length > MAX_BUFFER) {
    LOG_BUFFER.splice(0, LOG_BUFFER.length - MAX_BUFFER);
  }
}

/**
 * Create a scoped logger for a specific module/feature.
 *
 * Usage:
 *   const log = createLogger('crops');
 *   log.info('Rectangle drawn', { lng: 2.35, lat: 48.86 });
 */
export function createLogger(tag: string) {
  return {
    debug: (msg: string, ...args: unknown[]) => log('debug', tag, msg, ...args),
    info:  (msg: string, ...args: unknown[]) => log('info', tag, msg, ...args),
    warn:  (msg: string, ...args: unknown[]) => log('warn', tag, msg, ...args),
    error: (msg: string, ...args: unknown[]) => log('error', tag, msg, ...args),
  };
}
