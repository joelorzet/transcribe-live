import type { LanguageCode } from './language.ts';

/**
 * One unit of recognised speech.
 *
 * The speech model emits two kinds of results:
 *  - `interim`  : fast, speculative, overwritten by the next interim. Drives the
 *                 "currently being spoken" caption line.
 *  - `final`    : authoritative for a segment of speech. Only finals are
 *                 translated, persisted and exported, so we never pay to
 *                 translate text that is about to be revised.
 */
export type SegmentKind = 'interim' | 'final';

export interface Translation {
  language: LanguageCode;
  text: string;
  /** ms between having the final transcript and having this translation. */
  latencyMs: number;
}

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  /** Monotonic per session. Lets clients reorder and de-duplicate. */
  seq: number;
  kind: SegmentKind;
  text: string;
  /** Detected (or configured) language of the spoken audio. */
  language: LanguageCode;
  /** Offset from session start, derived from audio ingested so far. */
  audioOffsetMs: number;
  /** Wall-clock epoch ms when the caption became available to us. */
  createdAt: number;
  /**
   * End-to-end caption latency: from the moment the audio that produced this
   * text finished arriving, to the moment we had the text. This is the number
   * the "latency" judging criterion cares about.
   */
  latencyMs: number;
  translations: Translation[];
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Final segments only — interims are noise for exports and analytics. */
export function isFinal(segment: TranscriptSegment): boolean {
  return segment.kind === 'final';
}

export function findTranslation(
  segment: TranscriptSegment,
  language: LanguageCode,
): string | undefined {
  return segment.translations.find((t) => t.language === language)?.text;
}
