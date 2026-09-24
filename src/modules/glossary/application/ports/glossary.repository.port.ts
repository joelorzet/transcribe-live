import type { Glossary } from '@modules/glossary/domain/glossary.entity';

export interface GlossaryRepositoryPort {
  get(id: string): Glossary;
  find(id: string): Glossary | undefined;
  list(): Glossary[];
  save(glossary: Glossary): Glossary;
  remove(id: string): void;
}
