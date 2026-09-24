import { randomUUID } from 'node:crypto';
import NodeMediaServer from 'node-media-server';
import type { LoggerPort } from '@shared/ports/system.port';

export const RTMP_APP = 'live';

export interface RtmpRelayHandlers {
  onPublish: (trackId: string, pullUrl: string) => void;
  onUnpublish: (trackId: string) => void;
}

export class RtmpRelay {
  #server: NodeMediaServer | undefined;
  readonly #keys = new Map<string, string>();
  readonly #publishing = new Set<string>();

  constructor(
    private readonly port: number,
    private readonly logger: LoggerPort,
    private readonly handlers: RtmpRelayHandlers,
  ) {}

  start(): void {
    if (this.#server) return;

    this.#server = new NodeMediaServer({
      rtmp: { port: this.port },
      logger: { level: 'error' },
      store: { path: '.nms-store' },
    });

    this.#server.on('postPublish', (session) => {
      const trackId = this.#keys.get(session.streamName);

      if (!trackId || session.streamApp !== RTMP_APP) {
        this.logger.warn('rejected rtmp publish with an unknown stream key', {
          app: session.streamApp,
          ip: session.ip,
        });
        session.close();
        return;
      }

      this.#publishing.add(trackId);
      this.logger.info('rtmp publisher connected', { sessionId: trackId });
      this.handlers.onPublish(trackId, `rtmp://127.0.0.1:${this.port}/${RTMP_APP}/${session.streamName}`);
    });

    this.#server.on('donePublish', (session) => {
      const trackId = this.#keys.get(session.streamName);
      if (!trackId || !this.#publishing.has(trackId)) return;
      this.#publishing.delete(trackId);
      this.logger.info('rtmp publisher disconnected', { sessionId: trackId });
      this.handlers.onUnpublish(trackId);
    });

    this.#server.run();
    this.logger.info('rtmp relay listening', { port: this.port, app: RTMP_APP });
  }

  register(trackId: string): string {
    this.unregister(trackId);
    const key = randomUUID();
    this.#keys.set(key, trackId);
    return key;
  }

  unregister(trackId: string): void {
    for (const [key, id] of this.#keys) {
      if (id === trackId) this.#keys.delete(key);
    }
    this.#publishing.delete(trackId);
  }

  stop(): void {
    this.#server?.stop();
    this.#server = undefined;
    this.#keys.clear();
    this.#publishing.clear();
  }
}
