import type { TranscriptSegment } from '@modules/transcription/domain/transcript.entity';

export interface TranscriptStorePort {
  append(segment: TranscriptSegment): void;
  finals(sessionId: string): TranscriptSegment[];
  recent(sessionId: string, limit: number): TranscriptSegment[];
  clear(sessionId: string): void;
}
