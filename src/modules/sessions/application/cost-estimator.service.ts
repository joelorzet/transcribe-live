import type { Session, SessionCost } from '@modules/sessions/domain/session.entity';

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

  estimate(session: Session): SessionCost {
    const audioTokens = session.audioSeconds * AUDIO_TOKENS_PER_SECOND;
    const usd =
      (audioTokens / 1_000_000) * this.rates.audioInputPerMTok +
      (session.translationInputTokens / 1_000_000) * this.rates.textInputPerMTok +
      (session.translationOutputTokens / 1_000_000) * this.rates.textOutputPerMTok;

    return {
      audioSeconds: Number(session.audioSeconds.toFixed(1)),
      translationInputTokens: session.translationInputTokens,
      translationOutputTokens: session.translationOutputTokens,
      usd: Number(usd.toFixed(4)),
    };
  }

  projectEventCost(sessions: number, hours: number, translationsPerSecond = 0.5): number {
    const seconds = sessions * hours * 3600;
    const audioUsd = ((seconds * AUDIO_TOKENS_PER_SECOND) / 1_000_000) * this.rates.audioInputPerMTok;
    const translations = seconds * translationsPerSecond;
    const textUsd =
      ((translations * 45) / 1_000_000) * this.rates.textInputPerMTok +
      ((translations * 25) / 1_000_000) * this.rates.textOutputPerMTok;
    return Number((audioUsd + textUsd).toFixed(2));
  }
}
