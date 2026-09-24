import type { TranscriptSegment } from '@modules/transcription/domain/transcript.entity';
import { isFinal } from '@modules/transcription/domain/transcript.entity';
import type { TranscriptStorePort } from '@modules/transcription/application/ports/transcript-store.port';

export class InMemoryTranscriptStore implements TranscriptStorePort {
  readonly #bySession = new Map<string, TranscriptSegment[]>();
  readonly #maxPerSession: number;

  constructor(maxPerSession = 20_000) {
    this.#maxPerSession = maxPerSession;
  }

  append(segment: TranscriptSegment): void {
    const list = this.#bySession.get(segment.sessionId) ?? [];
    list.push(segment);
    if (list.length > this.#maxPerSession) list.shift();
    this.#bySession.set(segment.sessionId, list);
  }

  finals(sessionId: string): TranscriptSegment[] {
    return (this.#bySession.get(sessionId) ?? []).filter(isFinal);
  }

  recent(sessionId: string, limit: number): TranscriptSegment[] {
    const finalsOnly = this.finals(sessionId);
    return finalsOnly.slice(Math.max(0, finalsOnly.length - limit));
  }

  clear(sessionId: string): void {
    this.#bySession.delete(sessionId);
  }
}
