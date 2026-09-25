import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { Server } from 'node:http';
import { LiveSessionService } from '@modules/sessions/application/live-session.service';
import { CONTROL_ROOM } from '@modules/events/application/ports/event-publisher.port';
import type { AudienceView } from '@modules/events/application/ports/event-publisher.port';
import type { SessionSnapshot } from '@modules/sessions/domain/session.entity';
import { isLanguageCode } from '@shared/language/language';
import type { LanguageCode } from '@shared/language/language';
import type { EventPublisherPort, SessionEvent } from '@modules/events/application/ports/event-publisher.port';
import type { TranscriptStorePort } from '@modules/transcription/application/ports/transcript-store.port';
import type { SessionRepositoryPort } from '@modules/sessions/application/ports/session.repository.port';
import type { LoggerPort } from '@shared/ports/system.port';
import { EVENT_PUBLISHER, LOGGER, SESSION_REPOSITORY, TRANSCRIPT_STORE } from '@shared/tokens';

const INGEST_PATH = '/ws/ingest';
const VIEW_PATH = '/ws/view';
const REPLAY_SEGMENTS = 25;
/**
 * Telemetry is for the production team, not the room. A caption consumer still
 * needs the occasional snapshot for the output list and the playback position,
 * but at a pace that keeps the socket about subtitles.
 */
const VIEWER_STATS_INTERVAL_MS = 5000;

@Injectable()
export class RealtimeGateway implements OnApplicationShutdown {
  readonly #ingest = new WebSocketServer({ noServer: true });
  readonly #view = new WebSocketServer({ noServer: true });
  readonly #log: LoggerPort;

  constructor(
    private readonly live: LiveSessionService,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
    @Inject(TRANSCRIPT_STORE) private readonly transcripts: TranscriptStorePort,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(LOGGER) logger: LoggerPort,
  ) {
    this.#log = logger.child({ component: 'realtime' });
    this.#ingest.on('connection', (socket: WebSocket, sessionId: string) =>
      this.#onIngest(socket, sessionId),
    );
    this.#view.on('connection', (socket: WebSocket, topic: string, language?: LanguageCode) =>
      this.#onViewer(socket, topic, language),
    );
  }

  bind(server: Server): void {
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const sessionId = url.searchParams.get('sessionId')?.trim() ?? '';

      if (url.pathname === INGEST_PATH && sessionId !== '') {
        this.#ingest.handleUpgrade(request, socket, head, (ws) =>
          this.#ingest.emit('connection', ws, sessionId),
        );
        return;
      }

      if (url.pathname === VIEW_PATH) {
        const topic = sessionId === '' ? CONTROL_ROOM : sessionId;
        const raw = url.searchParams.get('lang')?.trim().toLowerCase() ?? '';
        const language = isLanguageCode(raw) ? raw : undefined;
        this.#view.handleUpgrade(request, socket, head, (ws) =>
          this.#view.emit('connection', ws, topic, language),
        );
        return;
      }

      socket.destroy();
    });
    this.#log.info('websocket endpoints ready', { ingest: INGEST_PATH, view: VIEW_PATH });
  }

  #onIngest(socket: WebSocket, sessionId: string): void {
    if (!this.sessions.find(sessionId)) {
      socket.close(4404, `unknown session ${sessionId}`);
      return;
    }
    this.#log.info('ingest connected', { sessionId });

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) return;
      try {
        this.live.ingest(sessionId, data);
      } catch (error) {
        socket.close(4400, error instanceof Error ? error.message : 'ingest failed');
      }
    });

    socket.on('close', () => this.#log.info('ingest disconnected', { sessionId }));
    socket.on('error', (error) => this.#log.warn('ingest socket error', { sessionId, error: String(error) }));
  }

  #onViewer(socket: WebSocket, topic: string, language?: LanguageCode): void {
    const send = (payload: unknown): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };

    const isControlRoom = topic === CONTROL_ROOM;

    const snapshots = this.live.listSnapshots();
    if (isControlRoom) {
      send({ type: 'hello', topic, sessions: snapshots });
    } else {
      const mine = snapshots.find((snapshot) => snapshot.id === topic);
      send({ type: 'hello', topic, language, session: mine ? toAudienceView(mine) : null });
    }

    if (topic !== CONTROL_ROOM) {
      for (const segment of this.transcripts.recent(topic, REPLAY_SEGMENTS)) {
        send({ type: 'segment.final', sessionId: topic, segment } satisfies SessionEvent);
      }
    }

    let lastStatsAt = 0;

    const unsubscribe = this.publisher.subscribe(topic, (event) => {
      if (language && event.type === 'segment.translated' && event.translation.language !== language) {
        return;
      }

      // The room gets a slim view of the talk, never the production numbers.
      if ((event.type === 'session.stats' || event.type === 'session.ended') && !isControlRoom) {
        const now = Date.now();
        if (event.type === 'session.stats' && now - lastStatsAt < VIEWER_STATS_INTERVAL_MS) return;
        lastStatsAt = now;
        send({ type: 'session.view', session: toAudienceView(event.session) });
        return;
      }

      send(event);
    });
    socket.on('close', () => unsubscribe());
    socket.on('error', () => unsubscribe());
  }

  onApplicationShutdown(): void {
    for (const server of [this.#ingest, this.#view]) {
      for (const client of server.clients) client.terminate();
      server.close();
    }
  }
}

function toAudienceView(snapshot: SessionSnapshot): AudienceView {
  const outputs = snapshot.outputs ?? [];
  const typical = outputs.find((output) => output.latency.p50 > 0)?.latency.p50;

  return {
    id: snapshot.id,
    title: snapshot.title,
    status: snapshot.status,
    spokenLanguage: snapshot.sourceLanguage,
    languages: outputs.map((output) => output.language),
    positionSeconds: snapshot.input?.positionSeconds,
    captionLagMs: typical || snapshot.latency.p50 || 1500,
    hasAudio: Boolean(snapshot.input),
    waitingForPublisher: Boolean(snapshot.input?.waitingForPublisher),
    watchUrl: snapshot.watchUrl,
  };
}
