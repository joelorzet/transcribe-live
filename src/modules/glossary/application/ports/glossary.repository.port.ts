import type { Glossary } from '@modules/glossary/domain/glossary.entity';

export interface GlossaryRepositoryPort {
  get(id: string): Glossary;
  list(): Glossary[];
}
