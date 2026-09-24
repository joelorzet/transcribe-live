import { Module } from '@nestjs/common';
import { LiveSessionService } from '@modules/sessions/application/live-session.service';
import { CostEstimator } from '@modules/sessions/application/cost-estimator.service';
import { InMemorySessionRepository } from '@modules/sessions/infrastructure/in-memory-session.repository';
import { SessionsController } from '@modules/sessions/interfaces/sessions.controller';
import { TranscriptionModule } from '@modules/transcription/transcription.module';
import { TranslationModule } from '@modules/translation/translation.module';
import { GlossaryModule } from '@modules/glossary/glossary.module';
import { EventsModule } from '@modules/events/events.module';
import {
  APP_CONFIG,
  CLOCK,
  COST_ESTIMATOR,
  EVENT_PUBLISHER,
  GLOSSARY_REPOSITORY,
  LOGGER,
  SESSION_REPOSITORY,
  TRANSCRIPT_STORE,
  TRANSCRIPTION_ENGINE,
  TRANSLATOR,
} from '@shared/tokens';
import type { AppConfig } from '@shared/config/env';
import type { ClockPort, LoggerPort } from '@shared/ports/system.port';
import type { SessionRepositoryPort } from '@modules/sessions/application/ports/session.repository.port';
import type { TranscriptionEnginePort } from '@modules/transcription/application/ports/transcription-engine.port';
import type { TranscriptStorePort } from '@modules/transcription/application/ports/transcript-store.port';
import type { TranslatorPort } from '@modules/translation/application/ports/translator.port';
import type { GlossaryRepositoryPort } from '@modules/glossary/application/ports/glossary.repository.port';
import type { EventPublisherPort } from '@modules/events/application/ports/event-publisher.port';

@Module({
  imports: [TranscriptionModule, TranslationModule, GlossaryModule, EventsModule],
  controllers: [SessionsController],
  providers: [
    { provide: SESSION_REPOSITORY, useFactory: (): SessionRepositoryPort => new InMemorySessionRepository() },
    {
      provide: COST_ESTIMATOR,
      useFactory: (config: AppConfig): CostEstimator => new CostEstimator(config.costRates),
      inject: [APP_CONFIG],
    },
    {
      provide: LiveSessionService,
      useFactory: (
        engine: TranscriptionEnginePort,
        translator: TranslatorPort,
        sessions: SessionRepositoryPort,
        transcripts: TranscriptStorePort,
        glossaries: GlossaryRepositoryPort,
        publisher: EventPublisherPort,
        costEstimator: CostEstimator,
        clock: ClockPort,
        logger: LoggerPort,
        config: AppConfig,
      ): LiveSessionService =>
        new LiveSessionService({
          engine,
          translator,
          sessions,
          transcripts,
          glossaries,
          publisher,
          clock,
          logger,
          costEstimator,
          maxConcurrentSessions: config.maxConcurrentSessions,
          transcriptionMode: config.transcriptionMode,
          contextWindow: config.contextWindow,
        }),
      inject: [
        TRANSCRIPTION_ENGINE,
        TRANSLATOR,
        SESSION_REPOSITORY,
        TRANSCRIPT_STORE,
        GLOSSARY_REPOSITORY,
        EVENT_PUBLISHER,
        COST_ESTIMATOR,
        CLOCK,
        LOGGER,
        APP_CONFIG,
      ],
    },
  ],
  exports: [LiveSessionService, SESSION_REPOSITORY],
})
export class SessionsModule {}
