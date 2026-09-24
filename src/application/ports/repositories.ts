import type { Session } from '../../domain/session.ts';
import type { TranscriptSegment } from '../../domain/transcript.ts';
import type { Glossary } from '../../domain/glossary.ts';

export interface SessionRepositoryPort {
  add(session: Session): void;
  find(id: string): Session | undefined;
  list(): Session[];
  remove(id: string): void;
  get activeCount(): number;
}

export interface TranscriptStorePort {
  append(segment: TranscriptSegment): void;
  /** Final segments in order. Used by the SRT/VTT/JSON exporters. */
  finals(sessionId: string): TranscriptSegment[];
  /** Most recent final segments, newest last. Used to seed a joining viewer. */
  recent(sessionId: string, limit: number): TranscriptSegment[];
  clear(sessionId: string): void;
}

export interface GlossaryRepositoryPort {
  get(id: string): Glossary;
  list(): Glossary[];
}
