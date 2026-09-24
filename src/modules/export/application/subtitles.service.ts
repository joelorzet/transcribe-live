import type { TranscriptSegment } from '@modules/transcription/domain/transcript.entity';
import { findTranslation } from '@modules/transcription/domain/transcript.entity';
import type { LanguageCode } from '@shared/language/language';

const MIN_CUE_MS = 1200;
const MAX_CUE_MS = 7000;

interface Cue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

function toCues(segments: TranscriptSegment[], language?: LanguageCode): Cue[] {
  const cues: Cue[] = [];
  let previousEnd = 0;

  for (const segment of segments) {
    const text = language ? findTranslation(segment, language) : segment.text;
    if (!text || text.trim() === '') continue;

    const end = Math.max(segment.audioOffsetMs, previousEnd + MIN_CUE_MS);
    const start = Math.max(previousEnd, end - MAX_CUE_MS);
    cues.push({ index: cues.length + 1, startMs: start, endMs: end, text: text.trim() });
    previousEnd = end;
  }
  return cues;
}

function stamp(ms: number, separator: ',' | '.'): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = String(Math.floor(clamped / 3_600_000)).padStart(2, '0');
  const minutes = String(Math.floor((clamped % 3_600_000) / 60_000)).padStart(2, '0');
  const seconds = String(Math.floor((clamped % 60_000) / 1000)).padStart(2, '0');
  const millis = String(clamped % 1000).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}${separator}${millis}`;
}

export function toSrt(segments: TranscriptSegment[], language?: LanguageCode): string {
  return toCues(segments, language)
    .map((cue) => `${cue.index}\n${stamp(cue.startMs, ',')} --> ${stamp(cue.endMs, ',')}\n${cue.text}\n`)
    .join('\n');
}

export function toVtt(segments: TranscriptSegment[], language?: LanguageCode): string {
  const body = toCues(segments, language)
    .map((cue) => `${cue.index}\n${stamp(cue.startMs, '.')} --> ${stamp(cue.endMs, '.')}\n${cue.text}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

export function toPlainText(segments: TranscriptSegment[], language?: LanguageCode): string {
  return segments
    .map((s) => (language ? findTranslation(s, language) : s.text))
    .filter((t): t is string => Boolean(t && t.trim()))
    .join('\n');
}

export function toJson(segments: TranscriptSegment[]): string {
  return JSON.stringify(segments, null, 2);
}
