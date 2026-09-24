import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_GLOSSARY } from '@modules/glossary/domain/glossary.entity';
import type { Glossary } from '@modules/glossary/domain/glossary.entity';
import type { GlossaryRepositoryPort } from '@modules/glossary/application/ports/glossary.repository.port';

export class FileGlossaryRepository implements GlossaryRepositoryPort {
  readonly #glossaries = new Map<string, Glossary>();
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
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

  find(id: string): Glossary | undefined {
    return this.#glossaries.get(id);
  }

  list(): Glossary[] {
    return [...this.#glossaries.values()];
  }

  save(glossary: Glossary): Glossary {
    this.#glossaries.set(glossary.id, glossary);
    if (glossary.id !== EMPTY_GLOSSARY.id) {
      mkdirSync(this.#directory, { recursive: true });
      writeFileSync(
        join(this.#directory, `${glossary.id}.json`),
        `${JSON.stringify(glossary, null, 2)}\n`,
        'utf8',
      );
    }
    return glossary;
  }

  remove(id: string): void {
    if (id === EMPTY_GLOSSARY.id) return;
    this.#glossaries.delete(id);
    const path = join(this.#directory, `${id}.json`);
    if (existsSync(path)) rmSync(path);
  }
}
