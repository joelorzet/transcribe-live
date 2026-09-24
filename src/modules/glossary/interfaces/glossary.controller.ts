import { Controller, Get, Inject } from '@nestjs/common';
import { GLOSSARY_REPOSITORY } from '@shared/tokens';
import type { GlossaryRepositoryPort } from '@modules/glossary/application/ports/glossary.repository.port';
import type { Glossary } from '@modules/glossary/domain/glossary.entity';

@Controller('api/glossaries')
export class GlossaryController {
  constructor(@Inject(GLOSSARY_REPOSITORY) private readonly glossaries: GlossaryRepositoryPort) {}

  @Get()
  list(): { glossaries: Array<{ id: string; name: string; terms: number }> } {
    return {
      glossaries: this.glossaries.list().map((g: Glossary) => ({
        id: g.id,
        name: g.name,
        terms: g.terms.length,
      })),
    };
  }
}
