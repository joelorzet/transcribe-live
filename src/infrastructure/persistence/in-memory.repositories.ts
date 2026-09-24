import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Session } from '../../domain/session.ts';
import type { TranscriptSegment } from '../../domain/transcript.ts';
import { isFinal } from '../../domain/transcript.ts';
import { EMPTY_GLOSSARY, type Glossary } from '../../domain/glossary.ts';
import type {
  GlossaryRepositoryPort,
  SessionRepositoryPort,
  TranscriptStorePort,
} from '../../application/ports/repositories.ts';

export class InMemorySessionRepository implements SessionRepositoryPort {
  readonly #sessions = new Map<string, Session>();

  add(session: Session): void {
    this.#sessions.set(session.id, session);
  }
  find(id: string): Session | undefined {
    return this.#sessions.get(id);
  }
  list(): Session[] {
    return [...this.#sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  remove(id: string): void {
    this.#sessions.delete(id);
  }
  get activeCount(): number {
    return [...this.#sessions.values()].filter((s) => s.isActive).length;
  }
}

/**
 * Transcripts live in memory with a per-session cap. A conference day of one
 * track is a few thousand segments, so this is comfortably bounded; swapping
 * in Postgres means implementing one interface.
 */
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

/** Loads glossaries from JSON files on disk so operators can edit them per track. */
export class FileGlossaryRepository implements GlossaryRepositoryPort {
  readonly #glossaries = new Map<string, Glossary>();

  constructor(directory: string) {
    this.#glossaries.set(EMPTY_GLOSSARY.id, EMPTY_GLOSSARY);
    if (!existsSync(directory)) return;
    for (const file of readdirSync(directory)) {
      if (!file.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(directory, file), 'utf8')) as Glossary;
        const id = parsed.id || file.replace(/\.json$/, '');
        this.#glossaries.set(id, { ...parsed, id });
      } catch (error) {
        console.error(`Skipping malformed glossary ${file}: ${String(error)}`);
      }
    }
  }

  get(id: string): Glossary {
    return this.#glossaries.get(id) ?? EMPTY_GLOSSARY;
  }

  list(): Glossary[] {
    return [...this.#glossaries.values()];
  }
}
