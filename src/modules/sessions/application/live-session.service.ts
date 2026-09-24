import { randomUUID } from 'node:crypto';
import { Session, pcmBytesToMs, type SessionConfig, type SessionSnapshot } from '@modules/sessions/domain/session.entity';
import { countWords, type TranscriptSegment, type Translation } from '@modules/transcription/domain/transcript.entity';
import { toCustomVocabulary } from '@modules/glossary/domain/glossary.entity';
import { parseLanguage, type LanguageCode } from '@shared/language/language';
import { detectLanguage } from '@shared/language/language-detector';
import { CapacityExceededError, SessionAlreadyExistsError, SessionNotFoundError } from '@modules/sessions/domain/session.errors';
import type { TranscriptionEnginePort, TranscriptionMode, TranscriptionStream } from '@modules/transcription/application/ports/transcription-engine.port';
import type { TranslatorPort } from '@modules/translation/application/ports/translator.port';
import type { SessionRepositoryPort } from '@modules/sessions/application/ports/session.repository.port';
import type { TranscriptStorePort } from '@modules/transcription/application/ports/transcript-store.port';
import type { GlossaryRepositoryPort } from '@modules/glossary/application/ports/glossary.repository.port';
import type { EventPublisherPort } from '@modules/events/application/ports/event-publisher.port';
import type { ClockPort, LoggerPort } from '@shared/ports/system.port';
import type { CostEstimator } from '@modules/sessions/application/cost-estimator.service';

export interface LiveSessionServiceOptions {
  engine: TranscriptionEnginePort;
  translator: TranslatorPort;
  sessions: SessionRepositoryPort;
  transcripts: TranscriptStorePort;
  glossaries: GlossaryRepositoryPort;
  publisher: EventPublisherPort;
  clock: ClockPort;
  logger: LoggerPort;
  costEstimator: CostEstimator;
  maxConcurrentSessions: number;
  transcriptionMode: TranscriptionMode;
  contextWindow: number;
  autoDetectLanguages: LanguageCode[];
}

interface RunningSession {
  session: Session;
  stream: TranscriptionStream;
  lastAudioAt: number;
  queue: Promise<void>;
  recentText: string[];
}

export class LiveSessionService {
  readonly #opts: LiveSessionServiceOptions;
  readonly #running = new Map<string, RunningSession>();

  constructor(options: LiveSessionServiceOptions) {
    this.#opts = options;
  }

  get runningCount(): number {
    return this.#running.size;
  }

  async start(config: Omit<SessionConfig, 'id'> & { id?: string }): Promise<SessionSnapshot> {
    const { sessions, glossaries, engine, clock, logger, publisher, maxConcurrentSessions } = this.#opts;

    if (this.#running.size >= maxConcurrentSessions) {
      throw new CapacityExceededError(maxConcurrentSessions);
    }

    const id = config.id?.trim() || `s-${randomUUID().slice(0, 8)}`;
    if (sessions.find(id)) throw new SessionAlreadyExistsError(id);

    const session = new Session({ ...config, id }, clock.now());
    const glossary = glossaries.get(config.glossaryId);
    sessions.add(session);

    const log = logger.child({ sessionId: id });
    log.info('starting session', { title: session.title, glossary: glossary.id });

    const stream = await engine.open({
      sessionId: id,
      sourceLanguage: session.sourceLanguage,
      vocabulary: toCustomVocabulary(glossary),
      mode: this.#opts.transcriptionMode,
      onInterim: (result) => this.#onInterim(id, result.text, result.language),
      onFinal: (result) => this.#onFinal(id, result.text, result.language),
      onRotate: () => {
        session.rotations += 1;
        log.info('rotated upstream stream', { rotations: session.rotations });
      },
      onError: (error) => {
        log.error('engine error', { error: error.message });
        session.markFailed(error.message, clock.now());
        publisher.publish(id, { type: 'session.stats', session: this.snapshot(session) });
      },
    });

    this.#running.set(id, {
      session,
      stream,
      lastAudioAt: clock.now(),
      queue: Promise.resolve(),
      recentText: [],
    });

    session.markLive(clock.now());
    const snapshot = this.snapshot(session);
    publisher.publish(id, { type: 'session.started', session: snapshot });
    return snapshot;
  }

  ingest(sessionId: string, pcm: Buffer): void {
    const running = this.#running.get(sessionId);
    if (!running) throw new SessionNotFoundError(sessionId);
    if (running.stream.closed) return;

    running.session.audioMs += pcmBytesToMs(pcm.byteLength);
    running.lastAudioAt = this.#opts.clock.now();
    running.stream.write(pcm);
  }

  async stop(sessionId: string): Promise<SessionSnapshot> {
    const { sessions, clock, publisher, logger } = this.#opts;
    const session = sessions.find(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    const running = this.#running.get(sessionId);
    if (running) {
      this.#running.delete(sessionId);
      await running.queue.catch(() => {});
      await running.stream.close().catch((error: unknown) => {
        logger.warn('error closing stream', { sessionId, error: String(error) });
      });
    }

    session.markEnded(clock.now());
    const snapshot = this.snapshot(session);
    publisher.publish(sessionId, { type: 'session.ended', session: snapshot });
    logger.info('session ended', { sessionId, segments: session.segments, words: session.words });
    return snapshot;
  }

  async remove(sessionId: string): Promise<void> {
    const { sessions, transcripts, logger } = this.#opts;
    if (!sessions.find(sessionId)) throw new SessionNotFoundError(sessionId);

    await this.stop(sessionId).catch(() => undefined);
    transcripts.clear(sessionId);
    sessions.remove(sessionId);
    logger.info('session removed', { sessionId });
  }

  removeEnded(): number {
    const { sessions, transcripts } = this.#opts;
    let removed = 0;
    for (const session of sessions.list()) {
      if (session.isActive) continue;
      transcripts.clear(session.id);
      sessions.remove(session.id);
      removed += 1;
    }
    return removed;
  }

  snapshot(session: Session): SessionSnapshot {
    session.viewers = this.#opts.publisher.subscriberCount(session.id);
    return session.toSnapshot(this.#opts.costEstimator.estimate(session));
  }

  listSnapshots(): SessionSnapshot[] {
    return this.#opts.sessions.list().map((s) => this.snapshot(s));
  }

  publishStats(): void {
    for (const session of this.#opts.sessions.list()) {
      if (!session.isActive) continue;
      this.#opts.publisher.publish(session.id, { type: 'session.stats', session: this.snapshot(session) });
    }
  }

  #resolveLanguage(session: Session, text: string, detected?: LanguageCode): LanguageCode {
    if (detected) return detected;
    if (session.sourceLanguage !== 'auto') return session.sourceLanguage;

    const candidates = this.#opts.autoDetectLanguages;
    return detectLanguage(text, candidates) ?? candidates[0] ?? 'es';
  }

  #onInterim(sessionId: string, text: string, detected?: LanguageCode): void {
    const running = this.#running.get(sessionId);
    if (!running || text.trim() === '') return;
    this.#opts.publisher.publish(sessionId, {
      type: 'segment.interim',
      sessionId,
      text,
      language: this.#resolveLanguage(running.session, text, detected),
      at: this.#opts.clock.now(),
    });
  }

  #onFinal(sessionId: string, text: string, detected?: LanguageCode): void {
    const running = this.#running.get(sessionId);
    if (!running || text.trim() === '') return;

    const { clock, transcripts, publisher } = this.#opts;
    const { session } = running;
    const now = clock.now();
    const language = this.#resolveLanguage(session, text, detected);
    const latencyMs = Math.max(0, now - running.lastAudioAt);

    const segment: TranscriptSegment = {
      id: randomUUID(),
      sessionId,
      seq: session.nextSeq(),
      kind: 'final',
      text,
      language,
      audioOffsetMs: Math.round(session.audioMs),
      createdAt: now,
      latencyMs,
      translations: [],
    };

    session.segments += 1;
    session.words += countWords(text);
    session.transcriptionLatency.record(latencyMs);
    session.captionLatency.record(latencyMs);

    transcripts.append(segment);
    publisher.publish(sessionId, { type: 'segment.final', sessionId, segment });

    running.recentText.push(text);
    if (running.recentText.length > this.#opts.contextWindow) running.recentText.shift();

    const targets = session.targetLanguages.filter((t) => t !== language);
    if (targets.length > 0) {
      running.queue = running.queue
        .then(() => this.#translate(running, segment, targets))
        .catch((error: unknown) => {
          this.#opts.logger.warn('translation failed', { sessionId, error: String(error) });
        });
    }
  }

  async #translate(running: RunningSession, segment: TranscriptSegment, targets: LanguageCode[]): Promise<void> {
    const { translator, glossaries, clock, publisher, logger } = this.#opts;
    const { session } = running;
    const glossary = glossaries.get(session.glossaryId);
    const context = running.recentText.slice(0, -1).join(' ');

    await Promise.all(
      targets.map(async (target) => {
        const startedAt = clock.now();
        try {
          const result = await translator.translate({
            text: segment.text,
            from: segment.language,
            to: target,
            glossary,
            context,
          });
          const translation: Translation = {
            language: target,
            text: result.text,
            latencyMs: clock.now() - startedAt,
          };
          segment.translations.push(translation);
          session.translationInputTokens += result.inputTokens;
          session.translationOutputTokens += result.outputTokens;
          session.captionLatency.record(segment.latencyMs + translation.latencyMs);

          publisher.publish(session.id, {
            type: 'segment.translated',
            sessionId: session.id,
            segmentId: segment.id,
            seq: segment.seq,
            translation,
          });
        } catch (error) {
          logger.warn('translate failed', { sessionId: session.id, target, error: String(error) });
        }
      }),
    );
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.#running.keys()].map((id) => this.stop(id).catch(() => {})));
  }
}

export function parseTargets(raw: string | undefined, fallback: LanguageCode[]): LanguageCode[] {
  if (!raw) return fallback;
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseLanguage);
  return parsed.length > 0 ? [...new Set(parsed)] : fallback;
}
