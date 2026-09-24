import type { LanguageCode } from '@shared/language/language';

export type SegmentKind = 'interim' | 'final';

export interface Translation {
  language: LanguageCode;
  text: string;
  latencyMs: number;
}

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  seq: number;
  kind: SegmentKind;
  text: string;
  language: LanguageCode;
  audioOffsetMs: number;
  createdAt: number;
  latencyMs: number;
  translations: Translation[];
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

export function isFinal(segment: TranscriptSegment): boolean {
  return segment.kind === 'final';
}

export function findTranslation(
  segment: TranscriptSegment,
  language: LanguageCode,
): string | undefined {
  return segment.translations.find((t) => t.language === language)?.text;
}
