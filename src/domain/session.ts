import type { LanguageCode, SourceLanguage } from './language.ts';
import { InvalidSessionStateError } from './errors.ts';
import { LatencyWindow, type LatencySnapshot } from './latency.ts';

export type SessionStatus = 'starting' | 'live' | 'ended' | 'error';

export interface SessionConfig {
  id: string;
  /** Human label shown in the control room, e.g. "Track A - Keynote". */
  title: string;
  sourceLanguage: SourceLanguage;
  /** Languages to translate finals into. ES<->EN is the required pair. */
  targetLanguages: LanguageCode[];
  glossaryId: string;
}

export interface SessionCost {
  audioSeconds: number;
  translationInputTokens: number;
  translationOutputTokens: number;
  usd: number;
}

export interface SessionSnapshot {
  id: string;
  title: string;
  status: SessionStatus;
  sourceLanguage: SourceLanguage;
  targetLanguages: LanguageCode[];
  glossaryId: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  /** Seconds of audio ingested. Drives both billing and the progress read-out. */
  audioSeconds: number;
  segments: number;
  words: number;
  /** How many times we transparently reconnected around the Live API cap. */
  rotations: number;
  viewers: number;
  latency: LatencySnapshot;
  transcriptionLatency: LatencySnapshot;
  cost: SessionCost;
  error?: string;
}

/**
 * Aggregate root for one conference track. Owns its own lifecycle and running
 * totals; knows nothing about WebSockets, Gemini or HTTP.
 */
export class Session {
  readonly id: string;
  readonly createdAt: number;
  title: string;
  sourceLanguage: SourceLanguage;
  targetLanguages: LanguageCode[];
  glossaryId: string;

  status: SessionStatus = 'starting';
  startedAt?: number;
  endedAt?: number;
  error?: string;

  /** Total audio ingested, in milliseconds, derived from PCM byte count. */
  audioMs = 0;
  segments = 0;
  words = 0;
  rotations = 0;
  viewers = 0;

  translationInputTokens = 0;
  translationOutputTokens = 0;

  readonly captionLatency = new LatencyWindow();
  readonly transcriptionLatency = new LatencyWindow();

  #seq = 0;

  constructor(config: SessionConfig, now: number) {
    this.id = config.id;
    this.title = config.title;
    this.sourceLanguage = config.sourceLanguage;
    this.targetLanguages = config.targetLanguages;
    this.glossaryId = config.glossaryId;
    this.createdAt = now;
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

  toSnapshot(cost: SessionCost): SessionSnapshot {
    return {
      id: this.id,
      title: this.title,
      status: this.status,
      sourceLanguage: this.sourceLanguage,
      targetLanguages: this.targetLanguages,
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

/** 16-bit mono PCM at 16 kHz => 32000 bytes per second. */
export const PCM_BYTES_PER_SECOND = 16000 * 2;

export function pcmBytesToMs(bytes: number): number {
  return (bytes / PCM_BYTES_PER_SECOND) * 1000;
}
