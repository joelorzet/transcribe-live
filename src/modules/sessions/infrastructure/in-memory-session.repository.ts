import type { Session } from '@modules/sessions/domain/session.entity';
import type { SessionRepositoryPort } from '@modules/sessions/application/ports/session.repository.port';

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
