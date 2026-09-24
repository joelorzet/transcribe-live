import { openPcmStream, resolveMediaUrl, isYouTubeUrl } from '@shared/media/media-source';
import type { PcmStream } from '@shared/media/media-source';
import { LiveSessionService } from '@modules/sessions/application/live-session.service';
import { DomainError } from '@shared/errors/domain.errors';
import type { LoggerPort } from '@shared/ports/system.port';

export class MediaIngestError extends DomainError {
  constructor(message: string) {
    super('ingest_failed', message, 422);
  }
}

export interface StartIngestOptions {
  trackId: string;
  source: string;
  startSeconds?: number;
  durationSeconds?: number;
}

export interface IngestStatus {
  trackId: string;
  source: string;
  secondsIngested: number;
  startedAt: number;
}

interface RunningIngest extends IngestStatus {
  stream: PcmStream;
}

export class MediaIngestService {
  readonly #running = new Map<string, RunningIngest>();

  constructor(
    private readonly live: LiveSessionService,
    private readonly logger: LoggerPort,
  ) {}

  async start(options: StartIngestOptions): Promise<IngestStatus> {
    const { trackId, source } = options;
    if (this.#running.has(trackId)) {
      throw new MediaIngestError(`Track "${trackId}" is already ingesting media`);
    }

    const log = this.logger.child({ sessionId: trackId, component: 'ingest' });
    const mediaUrl = await this.#resolve(source, log);
    const stream = openPcmStream({
      source: mediaUrl,
      realtime: true,
      startSeconds: options.startSeconds,
      durationSeconds: options.durationSeconds,
    });

    const entry: RunningIngest = {
      trackId,
      source,
      secondsIngested: 0,
      startedAt: Date.now(),
      stream,
    };
    this.#running.set(trackId, entry);

    stream.pcm.on('data', (chunk: Buffer) => {
      try {
        this.live.ingest(trackId, chunk);
        entry.secondsIngested += chunk.byteLength / (16000 * 2);
      } catch {
        this.stop(trackId);
      }
    });

    stream.pcm.on('end', () => {
      log.info('media ended', { seconds: Math.round(entry.secondsIngested) });
      this.#running.delete(trackId);
    });

    stream.process.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) log.warn('ffmpeg', { message: text.slice(0, 200) });
    });

    stream.process.on('error', (error) => {
      log.error('ffmpeg failed to start', { error: error.message });
      this.#running.delete(trackId);
    });

    log.info('ingest started', { source });
    return this.#toStatus(entry);
  }

  async #resolve(source: string, log: LoggerPort): Promise<string> {
    try {
      if (isYouTubeUrl(source)) log.info('resolving youtube audio');
      return await resolveMediaUrl(source);
    } catch (error) {
      throw new MediaIngestError(error instanceof Error ? error.message : String(error));
    }
  }

  stop(trackId: string): void {
    const entry = this.#running.get(trackId);
    if (!entry) return;
    entry.stream.stop();
    this.#running.delete(trackId);
    this.logger.info('ingest stopped', { sessionId: trackId });
  }

  status(trackId: string): IngestStatus | undefined {
    const entry = this.#running.get(trackId);
    return entry ? this.#toStatus(entry) : undefined;
  }

  list(): IngestStatus[] {
    return [...this.#running.values()].map((entry) => this.#toStatus(entry));
  }

  #toStatus(entry: RunningIngest): IngestStatus {
    return {
      trackId: entry.trackId,
      source: entry.source,
      secondsIngested: Number(entry.secondsIngested.toFixed(1)),
      startedAt: entry.startedAt,
    };
  }

  shutdown(): void {
    for (const trackId of [...this.#running.keys()]) this.stop(trackId);
  }
}
