import type { LanguageCode, SourceLanguage } from '@shared/language/language';
import { InvalidSessionStateError } from '@modules/sessions/domain/session.errors';
import { LatencyWindow, type LatencySnapshot } from '@modules/sessions/domain/latency';
import { TrackOutput, type OutputSnapshot } from '@modules/sessions/domain/track-output.entity';

export type SessionStatus = 'starting' | 'live' | 'ended' | 'error';

export interface SessionConfig {
  id: string;
  title: string;
  sourceLanguage: SourceLanguage;
  targetLanguages: LanguageCode[];
  glossaryId: string;
}

export class OutputAlreadyExistsError extends InvalidSessionStateError {
  constructor(language: string) {
    super(`This track already streams a ${language} output`);
  }
}

export interface SessionCost {
  audioSeconds: number;
  translationInputTokens: number;
  translationOutputTokens: number;
  audioUsd: number;
  translationUsd: number;
  usd: number;
}

export interface SessionSnapshot {
  id: string;
  title: string;
  status: SessionStatus;
  sourceLanguage: SourceLanguage;
  targetLanguages: LanguageCode[];
  outputs: OutputSnapshot[];
  glossaryId: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  audioSeconds: number;
  segments: number;
  words: number;
  rotations: number;
  viewers: number;
  latency: LatencySnapshot;
  transcriptionLatency: LatencySnapshot;
  cost: SessionCost;
  error?: string;
}

export class Session {
  readonly id: string;
  readonly createdAt: number;
  title: string;
  sourceLanguage: SourceLanguage;
  glossaryId: string;

  readonly outputs = new Map<LanguageCode, TrackOutput>();

  status: SessionStatus = 'starting';
  startedAt?: number;
  endedAt?: number;
  error?: string;

  audioMs = 0;
  segments = 0;
  words = 0;
  rotations = 0;
  viewers = 0;

  readonly captionLatency = new LatencyWindow();
  readonly transcriptionLatency = new LatencyWindow();

  #seq = 0;

  constructor(config: SessionConfig, now: number) {
    this.id = config.id;
    this.title = config.title;
    this.sourceLanguage = config.sourceLanguage;
    this.glossaryId = config.glossaryId;
    this.createdAt = now;
    for (const language of config.targetLanguages) this.addOutput(language, now);
  }

  get targetLanguages(): LanguageCode[] {
    return [...this.outputs.keys()];
  }

  addOutput(language: LanguageCode, now: number): TrackOutput {
    const existing = this.outputs.get(language);
    if (existing) throw new OutputAlreadyExistsError(language);
    const output = new TrackOutput(language, now);
    this.outputs.set(language, output);
    return output;
  }

  removeOutput(language: LanguageCode): boolean {
    return this.outputs.delete(language);
  }

  nextSeq(): number {
    this.#seq += 1;
    return this.#seq;
  }

  markLive(now: number): void {
    if (this.status === 'ended') {
      throw new InvalidSessionStateError(`Session "${this.id}" has already ended`);
    }
    if (this.status !== 'live') {
      this.status = 'live';
      this.startedAt ??= now;
    }
  }

  markEnded(now: number): void {
    if (this.status === 'ended') return;
    this.status = 'ended';
    this.endedAt = now;
  }

  markFailed(reason: string, now: number): void {
    this.status = 'error';
    this.error = reason;
    this.endedAt = now;
  }

  get isActive(): boolean {
    return this.status === 'starting' || this.status === 'live';
  }

  get audioSeconds(): number {
    return this.audioMs / 1000;
  }

  toSnapshot(cost: SessionCost, outputSnapshots: OutputSnapshot[] = []): SessionSnapshot {
    return {
      id: this.id,
      title: this.title,
      status: this.status,
      sourceLanguage: this.sourceLanguage,
      targetLanguages: this.targetLanguages,
      outputs: outputSnapshots,
      glossaryId: this.glossaryId,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      audioSeconds: Number(this.audioSeconds.toFixed(1)),
      segments: this.segments,
      words: this.words,
      rotations: this.rotations,
      viewers: this.viewers,
      latency: this.captionLatency.snapshot(),
      transcriptionLatency: this.transcriptionLatency.snapshot(),
      cost,
      error: this.error,
    };
  }
}

export const PCM_BYTES_PER_SECOND = 16000 * 2;

export function pcmBytesToMs(bytes: number): number {
  return (bytes / PCM_BYTES_PER_SECOND) * 1000;
}
