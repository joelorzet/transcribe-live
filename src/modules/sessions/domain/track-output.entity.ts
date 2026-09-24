import type { LanguageCode } from '@shared/language/language';
import { LatencyWindow, type LatencySnapshot } from '@modules/sessions/domain/latency';

export interface OutputSnapshot {
  language: LanguageCode;
  addedAt: number;
  segments: number;
  words: number;
  inputTokens: number;
  outputTokens: number;
  latency: LatencySnapshot;
  costUsd: number;
}

export class TrackOutput {
  readonly language: LanguageCode;
  readonly addedAt: number;
  readonly latency = new LatencyWindow();

  segments = 0;
  words = 0;
  inputTokens = 0;
  outputTokens = 0;

  constructor(language: LanguageCode, now: number) {
    this.language = language;
    this.addedAt = now;
  }

  record(words: number, inputTokens: number, outputTokens: number, latencyMs: number): void {
    this.segments += 1;
    this.words += words;
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.latency.record(latencyMs);
  }

  toSnapshot(costUsd: number): OutputSnapshot {
    return {
      language: this.language,
      addedAt: this.addedAt,
      segments: this.segments,
      words: this.words,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      latency: this.latency.snapshot(),
      costUsd,
    };
  }
}
