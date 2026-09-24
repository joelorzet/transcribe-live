import type { LoggerPort, LogLevel } from '@shared/ports/system.port';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const COLOR: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

export class ConsoleLogger implements LoggerPort {
  readonly #min: number;
  readonly #bindings: Record<string, unknown>;

  constructor(level: LogLevel = 'info', bindings: Record<string, unknown> = {}) {
    this.#min = ORDER[level];
    this.#bindings = bindings;
  }

  child(bindings: Record<string, unknown>): LoggerPort {
    const child = new ConsoleLogger('debug', { ...this.#bindings, ...bindings });
    Reflect.set(child, 'minOverride', this.#min);
    return child;
  }

  #write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const min = (Reflect.get(this, 'minOverride') as number | undefined) ?? this.#min;
    if (ORDER[level] < min) return;
    const merged = { ...this.#bindings, ...meta };
    const tail = Object.entries(merged)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    const stamp = new Date().toISOString().slice(11, 23);
    const out = `${COLOR[level]}${stamp} ${level.toUpperCase().padEnd(5)}\x1b[0m ${message}${tail ? ` \x1b[90m${tail}\x1b[0m` : ''}`;
    if (level === 'error' || level === 'warn') console.error(out);
    else console.log(out);
  }

  debug(m: string, meta?: Record<string, unknown>): void { this.#write('debug', m, meta); }
  info(m: string, meta?: Record<string, unknown>): void { this.#write('info', m, meta); }
  warn(m: string, meta?: Record<string, unknown>): void { this.#write('warn', m, meta); }
  error(m: string, meta?: Record<string, unknown>): void { this.#write('error', m, meta); }
}
