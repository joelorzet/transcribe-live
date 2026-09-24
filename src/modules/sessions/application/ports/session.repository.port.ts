import type { Session } from '@modules/sessions/domain/session.entity';

export interface SessionRepositoryPort {
  add(session: Session): void;
  find(id: string): Session | undefined;
  list(): Session[];
  remove(id: string): void;
  get activeCount(): number;
}
