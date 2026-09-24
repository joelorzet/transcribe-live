import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_GLOSSARY } from '@modules/glossary/domain/glossary.entity';
import type { Glossary } from '@modules/glossary/domain/glossary.entity';
import type { GlossaryRepositoryPort } from '@modules/glossary/application/ports/glossary.repository.port';

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
