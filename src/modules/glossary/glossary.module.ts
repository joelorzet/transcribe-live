import { Module } from '@nestjs/common';
import type { AppConfig } from '@shared/config/env';
import { APP_CONFIG, GLOSSARY_REPOSITORY } from '@shared/tokens';
import { FileGlossaryRepository } from '@modules/glossary/infrastructure/file-glossary.repository';
import type { GlossaryRepositoryPort } from '@modules/glossary/application/ports/glossary.repository.port';
import { GlossaryController } from '@modules/glossary/interfaces/glossary.controller';

@Module({
  controllers: [GlossaryController],
  providers: [
    {
      provide: GLOSSARY_REPOSITORY,
      useFactory: (config: AppConfig): GlossaryRepositoryPort => new FileGlossaryRepository(config.glossaryDir),
      inject: [APP_CONFIG],
    },
  ],
  exports: [GLOSSARY_REPOSITORY],
})
export class GlossaryModule {}
