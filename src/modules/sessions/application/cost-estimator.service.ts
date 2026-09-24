import type { Session, SessionCost } from '@modules/sessions/domain/session.entity';
import type { OutputSnapshot } from '@modules/sessions/domain/track-output.entity';

export interface CostRates {
  audioInputPerMTok: number;
  textInputPerMTok: number;
  textOutputPerMTok: number;
}

export const AUDIO_TOKENS_PER_SECOND = 25;

export class CostEstimator {
  readonly rates: CostRates;

  constructor(rates: CostRates) {
    this.rates = rates;
  }

  audioCost(audioSeconds: number): number {
    return ((audioSeconds * AUDIO_TOKENS_PER_SECOND) / 1_000_000) * this.rates.audioInputPerMTok;
  }

  translationCost(inputTokens: number, outputTokens: number): number {
    return (
      (inputTokens / 1_000_000) * this.rates.textInputPerMTok +
      (outputTokens / 1_000_000) * this.rates.textOutputPerMTok
    );
  }

  estimate(session: Session): SessionCost {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const output of session.outputs.values()) {
      inputTokens += output.inputTokens;
      outputTokens += output.outputTokens;
    }

    const audioUsd = this.audioCost(session.audioSeconds);
    const translationUsd = this.translationCost(inputTokens, outputTokens);

    return {
      audioSeconds: Number(session.audioSeconds.toFixed(1)),
      translationInputTokens: inputTokens,
      translationOutputTokens: outputTokens,
      audioUsd: Number(audioUsd.toFixed(4)),
      translationUsd: Number(translationUsd.toFixed(4)),
      usd: Number((audioUsd + translationUsd).toFixed(4)),
    };
  }

  outputSnapshots(session: Session): OutputSnapshot[] {
    return [...session.outputs.values()].map((output) =>
      output.toSnapshot(this.translationCost(output.inputTokens, output.outputTokens)),
    );
  }

  projectEventCost(sessions: number, hours: number, outputsPerSession = 1, translationsPerSecond = 0.5): number {
    const seconds = sessions * hours * 3600;
    const audioUsd = this.audioCost(seconds);
    const translations = seconds * translationsPerSecond * outputsPerSession;
    const textUsd = this.translationCost(translations * 45, translations * 25);
    return Number((audioUsd + textUsd).toFixed(2));
  }
}
