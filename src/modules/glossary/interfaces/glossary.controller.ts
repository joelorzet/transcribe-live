import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { GLOSSARY_REPOSITORY } from '@shared/tokens';
import { DomainError } from '@shared/errors/domain.errors';
import { EMPTY_GLOSSARY, MAX_VOCABULARY_TERMS } from '@modules/glossary/domain/glossary.entity';
import type { Glossary, GlossaryTerm } from '@modules/glossary/domain/glossary.entity';
import type { GlossaryRepositoryPort } from '@modules/glossary/application/ports/glossary.repository.port';

class GlossaryNotFoundError extends DomainError {
  constructor(id: string) {
    super('glossary_not_found', `No glossary with id "${id}"`, 404);
  }
}

interface GlossaryBody {
  id?: string;
  name?: string;
  description?: string;
  terms?: GlossaryTerm[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/;

@Controller('api/glossaries')
export class GlossaryController {
  constructor(@Inject(GLOSSARY_REPOSITORY) private readonly glossaries: GlossaryRepositoryPort) {}

  @Get()
  list(): { glossaries: Array<{ id: string; name: string; terms: number }> } {
    return {
      glossaries: this.glossaries.list().map((glossary) => ({
        id: glossary.id,
        name: glossary.name,
        terms: glossary.terms.length,
      })),
    };
  }

  @Get(':id')
  get(@Param('id') id: string): Glossary {
    const glossary = this.glossaries.find(id);
    if (!glossary) throw new GlossaryNotFoundError(id);
    return glossary;
  }

  @Post()
  create(@Body() body: GlossaryBody): Glossary {
    const id = (body.id ?? slugify(body.name ?? '')).trim();
    if (!ID_PATTERN.test(id)) {
      throw new BadRequestException('id must be 2-41 lowercase letters, digits or dashes');
    }
    if (this.glossaries.find(id)) {
      throw new BadRequestException(`Glossary "${id}" already exists`);
    }
    return this.glossaries.save(this.#build(id, body));
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: GlossaryBody): Glossary {
    if (id === EMPTY_GLOSSARY.id) {
      throw new BadRequestException('The "none" glossary cannot be edited');
    }
    if (!this.glossaries.find(id)) throw new GlossaryNotFoundError(id);
    return this.glossaries.save(this.#build(id, body));
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string): { removed: true } {
    if (id === EMPTY_GLOSSARY.id) {
      throw new BadRequestException('The "none" glossary cannot be removed');
    }
    if (!this.glossaries.find(id)) throw new GlossaryNotFoundError(id);
    this.glossaries.remove(id);
    return { removed: true };
  }

  #build(id: string, body: GlossaryBody): Glossary {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('name is required');

    const terms = (body.terms ?? [])
      .map((term) => ({
        term: String(term.term ?? '').trim(),
        keepVerbatim: Boolean(term.keepVerbatim),
        translations: sanitiseTranslations(term.translations),
      }))
      .filter((term) => term.term !== '');

    if (terms.length > MAX_VOCABULARY_TERMS * 10) {
      throw new BadRequestException(`A glossary cannot hold more than ${MAX_VOCABULARY_TERMS * 10} terms`);
    }

    return { id, name, description: body.description?.trim(), terms };
  }
}

function sanitiseTranslations(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, text]) => typeof text === 'string' && text.trim() !== '')
    .map(([language, text]) => [language.slice(0, 5), String(text).trim()]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 41);
}
