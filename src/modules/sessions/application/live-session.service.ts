import { randomUUID } from 'node:crypto';
import { Session, pcmBytesToMs, type SessionConfig, type SessionSnapshot } from '@modules/sessions/domain/session.entity';
import { countWords, type TranscriptSegment, type Translation } from '@modules/transcription/domain/transcript.entity';
import { toCustomVocabulary } from '@modules/glossary/domain/glossary.entity';
import { parseLanguage, type LanguageCode, type SourceLanguage } from '@shared/language/language';
import { detectLanguage } from '@shared/language/language-detector';
import {
  CapacityExceededError,
  EngineUnavailableError,
  SessionAlreadyExistsError,
  SessionNotFoundError,
} from '@modules/sessions/domain/session.errors';
import type { TranscriptionEnginePort, TranscriptionMode, TranscriptionStream } from '@modules/transcription/application/ports/transcription-engine.port';
import type { TranslatorPort } from '@modules/translation/application/ports/translator.port';
import type { SessionRepositoryPort } from '@modules/sessions/application/ports/session.repository.port';
import type { TranscriptStorePort } from '@modules/transcription/application/ports/transcript-store.port';
import type { GlossaryRepositoryPort } from '@modules/glossary/application/ports/glossary.repository.port';
import { CONTROL_ROOM } from '@modules/events/application/ports/event-publisher.port';
import type { EventPublisherPort } from '@modules/events/application/ports/event-publisher.port';
import type { ClockPort, LoggerPort } from '@shared/ports/system.port';
import type { CostEstimator } from '@modules/sessions/application/cost-estimator.service';
import type { InputRegistry } from '@shared/input/input-registry';

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
  inputRegistry: InputRegistry;
}

const SILENT_AFTER_MS = 12000;
const NO_FINAL_AFTER_MS = 20000;
const AUDIO_RECENT_MS = 5000;
const MAX_SILENT_RECOVERIES = 3;

const MAX_PENDING_BYTES = 32000 * 4;

interface RunningSession {
  session: Session;
  /** Opened on the first audio chunk, not when the track is created. */
  stream: TranscriptionStream | null;
  attaching: boolean;
  pending: Buffer[];
  pendingBytes: number;
  lastCaptionAt: number;
  lastFinalAt: number;
  silentRecoveries: number;
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
    const { sessions, clock, logger, publisher, maxConcurrentSessions } = this.#opts;

    if (this.#running.size >= maxConcurrentSessions) {
      throw new CapacityExceededError(maxConcurrentSessions);
    }

    const id = config.id?.trim() || `s-${randomUUID().slice(0, 8)}`;
    if (sessions.find(id)) throw new SessionAlreadyExistsError(id);

    const session = new Session({ ...config, id }, clock.now());
    sessions.add(session);
    logger.child({ sessionId: id }).info('starting session', { title: session.title });

    this.#running.set(id, {
      session,
      stream: null,
      attaching: false,
      pending: [],
      pendingBytes: 0,
      lastAudioAt: clock.now(),
      lastCaptionAt: clock.now(),
      lastFinalAt: clock.now(),
      silentRecoveries: 0,
      queue: Promise.resolve(),
      recentText: [],
    });

    const snapshot = this.snapshot(session);
    publisher.publish(id, { type: 'session.started', session: snapshot });
    return snapshot;
  }

  async restart(sessionId: string): Promise<SessionSnapshot> {
    const { sessions, publisher, logger, maxConcurrentSessions } = this.#opts;
    const session = sessions.find(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    if (this.#running.has(sessionId)) return this.snapshot(session);
    if (this.#running.size >= maxConcurrentSessions) {
      throw new CapacityExceededError(maxConcurrentSessions);
    }

    logger.child({ sessionId }).info('restarting session');
    session.prepareForRestart();
    this.#running.set(sessionId, {
      session,
      stream: null,
      attaching: false,
      pending: [],
      pendingBytes: 0,
      lastAudioAt: this.#opts.clock.now(),
      lastCaptionAt: this.#opts.clock.now(),
      lastFinalAt: this.#opts.clock.now(),
      silentRecoveries: 0,
      queue: Promise.resolve(),
      recentText: [],
    });

    const snapshot = this.snapshot(session);
    publisher.publish(sessionId, { type: 'session.started', session: snapshot });
    return snapshot;
  }

  async #attachStream(session: Session): Promise<void> {
    const { engine, glossaries, clock, logger, publisher } = this.#opts;
    const id = session.id;
    const glossary = glossaries.get(session.glossaryId);
    const log = logger.child({ sessionId: id });

    let stream;
    try {
      stream = await engine.open({
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
          log.warn('engine error; stream will try to recover', { error: error.message });
          session.noteError(error.message);
          publisher.publish(id, { type: 'session.stats', session: this.snapshot(session) });
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log.error('could not open the speech engine', { error: reason });
      const entry = this.#running.get(id);
      if (entry) entry.attaching = false;
      session.markFailed(reason, clock.now());
      throw new EngineUnavailableError(reason);
    }

    const running = this.#running.get(id);
    if (!running) {
      await stream.close().catch(() => undefined);
      return;
    }

    running.stream = stream;
    running.attaching = false;
    session.markLive(clock.now());

    for (const chunk of running.pending) stream.write(chunk);
    running.pending = [];
    running.pendingBytes = 0;

    log.info('speech stream opened on first audio');
  }

  ingest(sessionId: string, pcm: Buffer): void {
    const running = this.#running.get(sessionId);
    if (!running) throw new SessionNotFoundError(sessionId);

    running.session.audioMs += pcmBytesToMs(pcm.byteLength);
    running.lastAudioAt = this.#opts.clock.now();

    const stream = running.stream;
    if (stream) {
      if (!stream.closed) stream.write(pcm);
      return;
    }

    // First audio for this track. Hold a short window while the speech stream
    // is dialled, so opening late costs latency rather than words.
    running.pending.push(pcm);
    running.pendingBytes += pcm.byteLength;
    while (running.pendingBytes > MAX_PENDING_BYTES && running.pending.length > 0) {
      running.pendingBytes -= running.pending.shift()?.byteLength ?? 0;
    }

    if (!running.attaching) {
      running.attaching = true;
      void this.#attachStream(running.session).catch((error: unknown) => {
        this.#opts.logger.error('could not open the speech stream for arriving audio', {
          sessionId,
          error: String(error),
        });
      });
    }
  }

  async stop(sessionId: string): Promise<SessionSnapshot> {
    const { sessions, clock, publisher, logger } = this.#opts;
    const session = sessions.find(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    const running = this.#running.get(sessionId);
    if (running) {
      this.#running.delete(sessionId);
      await running.queue.catch(() => {});
      await running.stream?.close().catch((error: unknown) => {
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
    const { costEstimator, inputRegistry } = this.#opts;
    return session.toSnapshot(
      costEstimator.estimate(session),
      costEstimator.outputSnapshots(session),
      inputRegistry.get(session.id) ?? null,
    );
  }

  async changeSourceLanguage(sessionId: string, sourceLanguage: SourceLanguage): Promise<SessionSnapshot> {
    const { sessions, publisher, logger } = this.#opts;
    const session = sessions.find(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    const running = this.#running.get(sessionId);
    session.sourceLanguage = sourceLanguage;

    if (running?.stream) {
      await running.stream.reconfigure({ sourceLanguage });
      session.rotations += 1;
    }

    logger.info('source language changed', { sessionId, sourceLanguage });
    const snapshot = this.snapshot(session);
    publisher.publish(sessionId, { type: 'session.stats', session: snapshot });
    return snapshot;
  }

  async changeWatchUrl(sessionId: string, watchUrl: string | undefined): Promise<SessionSnapshot> {
    const { sessions, publisher, logger } = this.#opts;
    const session = sessions.find(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    session.watchUrl = watchUrl;
    logger.info('watch url changed', { sessionId, watchUrl: watchUrl ?? 'none' });

    const snapshot = this.snapshot(session);
    publisher.publish(sessionId, { type: 'session.stats', session: snapshot });
    return snapshot;
  }

  async changeGlossary(sessionId: string, glossaryId: string): Promise<SessionSnapshot> {
    const { sessions, glossaries, publisher, logger } = this.#opts;
    const session = sessions.find(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    const glossary = glossaries.get(glossaryId);
    session.glossaryId = glossary.id;

    const running = this.#running.get(sessionId);
    if (running?.stream) {
      await running.stream.reconfigure({ vocabulary: toCustomVocabulary(glossary) });
      session.rotations += 1;
    }

    logger.info('glossary changed', { sessionId, glossaryId: glossary.id });
    const snapshot = this.snapshot(session);
    publisher.publish(sessionId, { type: 'session.stats', session: snapshot });
    return snapshot;
  }

  addOutput(sessionId: string, language: LanguageCode): SessionSnapshot {
    const { sessions, clock, publisher, logger } = this.#opts;
    const session = sessions.find(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    session.addOutput(language, clock.now());
    logger.info('output added', { sessionId, language, outputs: session.outputs.size });

    const snapshot = this.snapshot(session);
    publisher.publish(sessionId, { type: 'session.stats', session: snapshot });
    return snapshot;
  }

  removeOutput(sessionId: string, language: LanguageCode): SessionSnapshot {
    const { sessions, publisher, logger } = this.#opts;
    const session = sessions.find(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    if (!session.removeOutput(language)) {
      throw new SessionNotFoundError(`${sessionId}/${language}`);
    }
    logger.info('output removed', { sessionId, language, outputs: session.outputs.size });

    const snapshot = this.snapshot(session);
    publisher.publish(sessionId, { type: 'session.stats', session: snapshot });
    return snapshot;
  }

  listSnapshots(): SessionSnapshot[] {
    return this.#opts.sessions.list().map((s) => this.snapshot(s));
  }

  publishStats(): void {
    // Watchdogs run whether or not anyone is watching: a talk losing its
    // captions has to be caught even with the control room closed.
    this.#reapDeadStreams();
    this.#recoverSilentStreams();

    const { publisher, sessions } = this.#opts;
    const controlRoomIsOpen = publisher.subscriberCount(CONTROL_ROOM) > 0;

    for (const session of sessions.list()) {
      if (!session.isActive) continue;
      // Building a snapshot walks every output and prices it. Nobody listening
      // means nobody to tell, so skip the work entirely.
      if (!controlRoomIsOpen && publisher.subscriberCount(session.id) === 0) continue;
      publisher.publish(session.id, { type: 'session.stats', session: this.snapshot(session) });
    }
  }

  #recoverSilentStreams(): void {
    const { clock, logger } = this.#opts;
    const now = clock.now();

    for (const [id, running] of this.#running) {
      if (!running.stream || running.stream.closed) continue;

      const audioIsFlowing = now - running.lastAudioAt < AUDIO_RECENT_MS;
      if (!audioIsFlowing) continue;

      const silentFor = now - running.lastCaptionAt;
      const withoutFinalFor = now - running.lastFinalAt;

      // Two ways a stream stalls: nothing at all, or endless interim text that
      // never settles into a final. Only finals are translated, so a stream
      // stuck on interims starves every output language while looking alive.
      const stalled =
        silentFor >= SILENT_AFTER_MS ? silentFor : withoutFinalFor >= NO_FINAL_AFTER_MS ? withoutFinalFor : 0;
      if (stalled === 0) continue;

      if (running.silentRecoveries >= MAX_SILENT_RECOVERIES) {
        running.session.noteError(
          `No captions for ${Math.round(stalled / 1000)}s while audio kept arriving.`,
        );
        continue;
      }

      running.silentRecoveries += 1;
      running.lastCaptionAt = now;
      running.lastFinalAt = now;
      logger.warn('audio is flowing but no captions arrived; reconnecting the speech stream', {
        sessionId: id,
        silentForMs: stalled,
        attempt: running.silentRecoveries,
      });

      void running.stream
        ?.reconfigure({ sourceLanguage: running.session.sourceLanguage })
        .catch((error: unknown) => {
          logger.error('silent stream recovery failed', { sessionId: id, error: String(error) });
        });
    }
  }

  #reapDeadStreams(): void {
    const { clock, logger, publisher } = this.#opts;
    for (const [id, running] of this.#running) {
      // A track with no stream yet is idle and waiting for audio, not dead.
      if (!running.stream || !running.stream.closed) continue;
      this.#running.delete(id);
      running.session.markFailed(
        running.session.error ?? 'the speech stream closed unexpectedly',
        clock.now(),
      );
      logger.warn('speech stream died; source marked as failed', { sessionId: id });
      publisher.publish(id, { type: 'session.stats', session: this.snapshot(running.session) });
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
    running.lastCaptionAt = this.#opts.clock.now();
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
    running.lastCaptionAt = now;
    running.lastFinalAt = now;
    running.silentRecoveries = 0;
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

    const targets = [...session.outputs.keys()].filter((t) => t !== language);
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
          const output = session.outputs.get(target);
          if (!output) return;
          output.record(
            countWords(result.text),
            result.inputTokens,
            result.outputTokens,
            segment.latencyMs + translation.latencyMs,
          );
          session.captionLatency.record(segment.latencyMs + translation.latencyMs);

          publisher.publish(session.id, {
            type: 'segment.translated',
            sessionId: session.id,
            segmentId: segment.id,
            seq: segment.seq,
            translation,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          logger.warn('translate failed', { sessionId: session.id, target, error: reason });
          // A caption that never arrives is worse than a visible failure. Quota
          // exhaustion in particular looks like nothing happening at all.
          session.noteError(
            /\b429\b|RESOURCE_EXHAUSTED/.test(reason)
              ? `Translation quota exhausted, so ${target} subtitles have stopped.`
              : `Translation into ${target} is failing: ${reason.slice(0, 120)}`,
          );
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
