import { randomUUID } from 'node:crypto';
import {
  openYouTubePcmStream,
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
import type { InputRegistry } from '@shared/input/input-registry';
import { RTMP_APP, type RtmpRelay } from '@modules/ingest/infrastructure/rtmp-relay';

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

function positionOf(startSeconds: number | undefined, ingested: number): number {
  return (startSeconds ?? 0) + ingested;
}

export type IngestKind = 'pull' | 'rtmp';

export interface IngestStatus {
  trackId: string;
  kind: IngestKind;
  startSeconds?: number;
  positionSeconds?: number;
  source: string;
  secondsIngested: number;
  startedAt: number;
  waitingForPublisher: boolean;
  pushUrl?: string;
  server?: string;
  streamKey?: string;
}

export interface RtmpEndpointOptions {
  host: string;
  port: number;
}

interface RunningIngest extends IngestStatus {
  stream: PcmStream | undefined;
}

export class MediaIngestService {
  readonly #running = new Map<string, RunningIngest>();

  constructor(
    private readonly live: LiveSessionService,
    private readonly logger: LoggerPort,
    private readonly rtmp: RtmpEndpointOptions,
    private readonly registry: InputRegistry,
    private readonly relay: RtmpRelay,
  ) {
    this.relay.start();
  }

  async startRtmp(trackId: string, publicHost: string): Promise<IngestStatus> {
    if (this.#running.has(trackId)) {
      throw new MediaIngestError(`Track "${trackId}" is already ingesting media`);
    }

    const host = this.rtmp.host || publicHost;
    const streamKey = this.relay.register(trackId);
    const server = `rtmp://${host}:${this.rtmp.port}/${RTMP_APP}`;

    const entry: RunningIngest = {
      trackId,
      kind: 'rtmp',
      source: `${server}/${streamKey}`,
      pushUrl: `${server}/${streamKey}`,
      server,
      streamKey,
      secondsIngested: 0,
      startedAt: Date.now(),
      waitingForPublisher: true,
      stream: undefined,
    };
    this.#running.set(trackId, entry);
    this.registry.set(trackId, {
      kind: 'rtmp',
      source: entry.source,
      secondsIngested: 0,
      startedAt: entry.startedAt,
      waitingForPublisher: true,
      server,
      streamKey,
    });

    this.logger.child({ sessionId: trackId, component: 'ingest' }).info('waiting for rtmp publisher', {
      server,
    });
    return this.#toStatus(entry);
  }

  attachPublisher(trackId: string, pullUrl: string): void {
    const entry = this.#running.get(trackId);
    if (!entry || entry.stream) return;

    const stream = openPcmStream({ source: pullUrl, realtime: false });
    entry.stream = stream;
    entry.waitingForPublisher = false;
    this.#wire(trackId, entry, stream);
    this.registry.patch(trackId, { waitingForPublisher: false });
  }

  detachPublisher(trackId: string): void {
    const entry = this.#running.get(trackId);
    if (!entry) return;
    entry.stream?.stop();
    entry.stream = undefined;
    entry.waitingForPublisher = true;
    this.registry.patch(trackId, { waitingForPublisher: true });
  }

  async start(options: StartIngestOptions): Promise<IngestStatus> {
    const { trackId, source } = options;
    if (this.#running.has(trackId)) {
      throw new MediaIngestError(`Track "${trackId}" is already ingesting media`);
    }

    const log = this.logger.child({ sessionId: trackId, component: 'ingest' });
    const stream = isYouTubeUrl(source)
      ? openYouTubePcmStream({
          source,
          startSeconds: options.startSeconds,
          durationSeconds: options.durationSeconds,
        })
      : openPcmStream({
          source: await this.#resolve(source, log),
          realtime: true,
          startSeconds: options.startSeconds,
          durationSeconds: options.durationSeconds,
        });

    const entry = this.#track(trackId, {
      kind: 'pull',
      source,
      waitingForPublisher: false,
      startSeconds: options.startSeconds ?? 0,
      positionSeconds: options.startSeconds ?? 0,
    }, stream);

    log.info('ingest started', { source });
    return this.#toStatus(entry);
  }

  #track(
    trackId: string,
    details: Pick<IngestStatus, 'kind' | 'source' | 'waitingForPublisher'> &
      Partial<Pick<IngestStatus, 'pushUrl' | 'server' | 'streamKey' | 'startSeconds' | 'positionSeconds'>>,
    stream: PcmStream,
  ): RunningIngest {
    const entry: RunningIngest = {
      trackId,
      secondsIngested: 0,
      startedAt: Date.now(),
      stream,
      ...details,
    };
    this.#running.set(trackId, entry);
    this.registry.set(trackId, {
      kind: entry.kind,
      source: entry.source,
      secondsIngested: 0,
      startedAt: entry.startedAt,
      waitingForPublisher: entry.waitingForPublisher,
      server: entry.server,
      streamKey: entry.streamKey,
      startSeconds: entry.startSeconds,
      positionSeconds: entry.positionSeconds,
    });

    this.#wire(trackId, entry, stream);
    return entry;
  }

  #wire(trackId: string, entry: RunningIngest, stream: PcmStream): void {
    const log = this.logger.child({ sessionId: trackId, component: 'ingest' });

    stream.pcm.on('data', (chunk: Buffer) => {
      entry.waitingForPublisher = false;
      try {
        this.live.ingest(trackId, chunk);
        entry.secondsIngested += chunk.byteLength / (16000 * 2);
        entry.positionSeconds = positionOf(entry.startSeconds, entry.secondsIngested);
        this.registry.patch(trackId, {
          waitingForPublisher: false,
          secondsIngested: Number(entry.secondsIngested.toFixed(1)),
          positionSeconds: Number(entry.positionSeconds.toFixed(2)),
        });
      } catch {
        this.stop(trackId);
      }
    });

    stream.pcm.on('end', () => {
      log.info('media ended', { seconds: Math.round(entry.secondsIngested) });
      if (entry.kind === 'rtmp') this.detachPublisher(trackId);
      else this.#release(trackId);
    });

    stream.process.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) log.warn('ffmpeg', { message: text.slice(0, 200) });
    });

    stream.process.on('error', (error) => {
      log.error('ffmpeg failed to start', { error: error.message });
      this.#release(trackId);
    });
  }

  #release(trackId: string): void {
    this.#running.delete(trackId);
    this.registry.clear(trackId);
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
    entry.stream?.stop();
    this.relay.unregister(trackId);
    this.#release(trackId);
    this.logger.info('ingest stopped', { sessionId: trackId });
  }

  /** Local HTTP-FLV address for a track that has a publisher connected. */
  playbackUrl(trackId: string): string | undefined {
    const entry = this.#running.get(trackId);
    if (!entry || entry.kind !== 'rtmp' || entry.waitingForPublisher || !entry.streamKey) {
      return undefined;
    }
    return this.relay.playbackUrl(entry.streamKey);
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
      server: entry.server,
      streamKey: entry.streamKey,
      startSeconds: entry.startSeconds,
      positionSeconds: entry.positionSeconds,
    };
  }

  shutdown(): void {
    for (const trackId of [...this.#running.keys()]) this.stop(trackId);
    this.relay.stop();
  }
}
