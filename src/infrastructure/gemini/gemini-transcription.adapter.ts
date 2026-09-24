import { LiveConnection } from './live-connection.ts';
import { toBcp47 } from '../../domain/language.ts';
import type {
  TranscriptionEnginePort,
  TranscriptionStream,
  TranscriptionStreamOptions,
} from '../../application/ports/transcription-engine.ts';
import type { LoggerPort } from '../../application/ports/system.ts';

export interface GeminiTranscriptionConfig {
  apiKey: string;
  model: string;
  /** Rotate this many seconds into a connection, ahead of the server cap. */
  rotateSeconds: number;
  logger: LoggerPort;
}

/** Audio buffered while a connection is coming up (~4s at 16 kHz mono). */
const MAX_PENDING_BYTES = 32000 * 4;
/** How long a retiring connection may keep flushing its final transcript. */
const DRAIN_MS = 1500;

export class GeminiTranscriptionEngine implements TranscriptionEnginePort {
  readonly name = 'gemini-live';
  readonly #config: GeminiTranscriptionConfig;

  constructor(config: GeminiTranscriptionConfig) {
    this.#config = config;
  }

  async open(options: TranscriptionStreamOptions): Promise<TranscriptionStream> {
    const stream = new RotatingTranscriptionStream(this.#config, options);
    await stream.start();
    return stream;
  }
}

/**
 * A transcription stream that outlives any single upstream connection.
 *
 * The Live API caps a session at roughly ten minutes, but conference talks run
 * 30-60. So we rotate: bring a replacement connection all the way up, swap the
 * write path onto it, then let the old one drain its tail. Audio is never
 * written to two connections at once, so nothing is transcribed twice, and the
 * audience sees no gap. We rotate on the server's own `goAway` warning when we
 * get one, and on a timer as a backstop.
 */
class RotatingTranscriptionStream implements TranscriptionStream {
  readonly #config: GeminiTranscriptionConfig;
  readonly #options: TranscriptionStreamOptions;
  readonly #log: LoggerPort;

  #active: LiveConnection | undefined;
  #pending: Buffer[] = [];
  #pendingBytes = 0;
  #rotating = false;
  #closed = false;
  #timer: NodeJS.Timeout | undefined;
  #recentFinals: string[] = [];
  #backoffMs = 500;

  constructor(config: GeminiTranscriptionConfig, options: TranscriptionStreamOptions) {
    this.#config = config;
    this.#options = options;
    this.#log = config.logger.child({ sessionId: options.sessionId });
  }

  get closed(): boolean {
    return this.#closed;
  }

  async start(): Promise<void> {
    this.#active = await this.#dial();
    this.#flushPending();
    this.#armRotation(this.#config.rotateSeconds * 1000);
  }

  #dial(): Promise<LiveConnection> {
    const { sourceLanguage, vocabulary, mode } = this.#options;
    const connection = new LiveConnection({
      apiKey: this.#config.apiKey,
      model: this.#config.model,
      languageCodes: sourceLanguage === 'auto' ? [] : [toBcp47(sourceLanguage)],
      vocabulary,
      mode,
      logger: this.#log,
      onInterim: (text, language) => {
        if (!this.#closed) this.#options.onInterim({ text, language });
      },
      onFinal: (text, language) => this.#emitFinal(text, language),
      onGoAway: (msLeft) => {
        this.#log.info('server goAway; rotating early', { msLeft });
        void this.#rotate();
      },
      onClosed: (code, reason) => this.#onUnexpectedClose(code, reason),
      onError: (error) => {
        if (!this.#closed) this.#options.onError(error);
      },
    });
    return connection.connect().then(() => connection);
  }

  /** Drops exact repeats, which can occur around a rotation boundary. */
  #emitFinal(text: string, language?: Parameters<TranscriptionStreamOptions['onFinal']>[0]['language']): void {
    if (this.#closed) return;
    const key = text.trim();
    if (key === '' || this.#recentFinals.includes(key)) return;
    this.#recentFinals.push(key);
    if (this.#recentFinals.length > 5) this.#recentFinals.shift();
    this.#options.onFinal({ text, language });
  }

  #armRotation(delayMs: number): void {
    clearTimeout(this.#timer);
    if (this.#closed) return;
    this.#timer = setTimeout(() => void this.#rotate(), Math.max(1000, delayMs));
  }

  async #rotate(): Promise<void> {
    if (this.#rotating || this.#closed) return;
    this.#rotating = true;
    clearTimeout(this.#timer);
    const retiring = this.#active;

    try {
      const next = await this.#dial();
      if (this.#closed) {
        await next.close();
        return;
      }
      // Swap first, so new audio goes only to the fresh connection...
      this.#active = next;
      this.#flushPending();
      this.#options.onRotate?.();
      // ...then let the old one flush whatever it was still holding.
      void retiring?.close(DRAIN_MS).catch(() => {});
      this.#backoffMs = 500;
      this.#armRotation(this.#config.rotateSeconds * 1000);
    } catch (error) {
      this.#log.warn('rotation failed; retrying', { error: String(error), backoffMs: this.#backoffMs });
      this.#armRotation(this.#backoffMs);
      this.#backoffMs = Math.min(this.#backoffMs * 2, 15000);
    } finally {
      this.#rotating = false;
    }
  }

  #onUnexpectedClose(code: number, reason: string): void {
    if (this.#closed) return;
    this.#log.warn('upstream closed unexpectedly; reconnecting', { code, reason });
    this.#active = undefined;
    void this.#rotate();
  }

  write(pcm: Buffer): void {
    if (this.#closed) return;
    const connection = this.#active;
    if (connection?.ready) {
      connection.write(pcm);
      return;
    }
    // Connection is coming up (first dial, rotation or reconnect): hold a short
    // window of audio so a handover costs latency, never words.
    this.#pending.push(pcm);
    this.#pendingBytes += pcm.byteLength;
    while (this.#pendingBytes > MAX_PENDING_BYTES && this.#pending.length > 0) {
      this.#pendingBytes -= this.#pending.shift()?.byteLength ?? 0;
    }
  }

  #flushPending(): void {
    const connection = this.#active;
    if (!connection?.ready || this.#pending.length === 0) return;
    for (const chunk of this.#pending) connection.write(chunk);
    this.#pending = [];
    this.#pendingBytes = 0;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#timer);
    await this.#active?.close(DRAIN_MS).catch(() => {});
    this.#active = undefined;
  }
}
