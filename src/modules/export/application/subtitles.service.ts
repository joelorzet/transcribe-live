import type { TranscriptSegment } from '@modules/transcription/domain/transcript.entity';
import { findTranslation } from '@modules/transcription/domain/transcript.entity';
import { splitIntoCaptions } from '@modules/transcription/domain/caption-splitter';
import type { LanguageCode } from '@shared/language/language';

const MIN_CUE_MS = 900;
const MAX_CUE_MS = 6000;
const DEFAULT_SEGMENT_MS = 3000;

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

    const lines = splitIntoCaptions(text);
    if (lines.length === 0) continue;

    const segmentEnd = Math.max(segment.audioOffsetMs, previousEnd + MIN_CUE_MS);
    const available = Math.max(segmentEnd - previousEnd, lines.length * MIN_CUE_MS);
    const segmentStart = segmentEnd - available;
    const totalChars = lines.reduce((sum, line) => sum + line.length, 0) || 1;

    let cursor = Math.max(previousEnd, segmentStart);
    for (const line of lines) {
      const share = (line.length / totalChars) * available;
      const duration = Math.min(MAX_CUE_MS, Math.max(MIN_CUE_MS, share || DEFAULT_SEGMENT_MS));
      const start = cursor;
      const end = start + duration;
      cues.push({ index: cues.length + 1, startMs: start, endMs: end, text: line });
      cursor = end;
    }
    previousEnd = cursor;
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
