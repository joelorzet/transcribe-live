import {
  buildRtmpListenUrl,
  buildRtmpPushUrl,
  isYouTubeUrl,
  openPcmStream,
  resolveMediaUrl,
} from '@shared/media/media-source';
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

export type IngestKind = 'pull' | 'rtmp';

export interface IngestStatus {
  trackId: string;
  kind: IngestKind;
  source: string;
  secondsIngested: number;
  startedAt: number;
  waitingForPublisher: boolean;
  pushUrl?: string;
}

export interface RtmpEndpointOptions {
  host: string;
  basePort: number;
  waitSeconds: number;
}

interface RunningIngest extends IngestStatus {
  stream: PcmStream;
  port?: number;
}

export class MediaIngestService {
  readonly #running = new Map<string, RunningIngest>();

  readonly #usedPorts = new Set<number>();

  constructor(
    private readonly live: LiveSessionService,
    private readonly logger: LoggerPort,
    private readonly rtmp: RtmpEndpointOptions,
  ) {}

  async startRtmp(trackId: string, publicHost: string): Promise<IngestStatus> {
    if (this.#running.has(trackId)) {
      throw new MediaIngestError(`Track "${trackId}" is already ingesting media`);
    }

    const port = this.#allocatePort();
    const host = this.rtmp.host || publicHost;
    const pushUrl = buildRtmpPushUrl(host, port, trackId);

    const stream = openPcmStream({
      source: buildRtmpListenUrl(port, trackId),
      listen: true,
      listenTimeoutSeconds: this.rtmp.waitSeconds,
      realtime: false,
    });

    const entry = this.#track(trackId, {
      kind: 'rtmp',
      source: pushUrl,
      pushUrl,
      waitingForPublisher: true,
      port,
    }, stream);

    this.logger.child({ sessionId: trackId, component: 'ingest' }).info('waiting for rtmp publisher', {
      pushUrl,
    });
    return this.#toStatus(entry);
  }

  #allocatePort(): number {
    for (let port = this.rtmp.basePort; port < this.rtmp.basePort + 200; port += 1) {
      if (!this.#usedPorts.has(port)) {
        this.#usedPorts.add(port);
        return port;
      }
    }
    throw new MediaIngestError('No RTMP ports available');
  }

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

    const entry = this.#track(trackId, {
      kind: 'pull',
      source,
      waitingForPublisher: false,
    }, stream);

    log.info('ingest started', { source });
    return this.#toStatus(entry);
  }

  #track(
    trackId: string,
    details: Pick<IngestStatus, 'kind' | 'source' | 'waitingForPublisher'> &
      Partial<Pick<IngestStatus, 'pushUrl'>> & { port?: number },
    stream: PcmStream,
  ): RunningIngest {
    const log = this.logger.child({ sessionId: trackId, component: 'ingest' });
    const entry: RunningIngest = {
      trackId,
      secondsIngested: 0,
      startedAt: Date.now(),
      stream,
      ...details,
    };
    this.#running.set(trackId, entry);

    stream.pcm.on('data', (chunk: Buffer) => {
      entry.waitingForPublisher = false;
      try {
        this.live.ingest(trackId, chunk);
        entry.secondsIngested += chunk.byteLength / (16000 * 2);
      } catch {
        this.stop(trackId);
      }
    });

    stream.pcm.on('end', () => {
      log.info('media ended', { seconds: Math.round(entry.secondsIngested) });
      this.#release(trackId);
    });

    stream.process.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) log.warn('ffmpeg', { message: text.slice(0, 200) });
    });

    stream.process.on('error', (error) => {
      log.error('ffmpeg failed to start', { error: error.message });
      this.#release(trackId);
    });

    return entry;
  }

  #release(trackId: string): void {
    const entry = this.#running.get(trackId);
    if (entry?.port) this.#usedPorts.delete(entry.port);
    this.#running.delete(trackId);
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
    this.#release(trackId);
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
      kind: entry.kind,
      source: entry.source,
      secondsIngested: Number(entry.secondsIngested.toFixed(1)),
      startedAt: entry.startedAt,
      waitingForPublisher: entry.waitingForPublisher,
      pushUrl: entry.pushUrl,
    };
  }

  shutdown(): void {
    for (const trackId of [...this.#running.keys()]) this.stop(trackId);
  }
}
