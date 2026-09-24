import { Module } from '@nestjs/common';
import type { AppConfig } from '@shared/config/env';
import type { LoggerPort } from '@shared/ports/system.port';
import { APP_CONFIG, LOGGER, TRANSCRIPT_STORE, TRANSCRIPTION_ENGINE } from '@shared/tokens';
import { GeminiTranscriptionEngine } from '@modules/transcription/infrastructure/gemini/gemini-transcription.adapter';
import { MockTranscriptionEngine } from '@modules/transcription/infrastructure/mock/mock-transcription.adapter';
import { InMemoryTranscriptStore } from '@modules/transcription/infrastructure/in-memory-transcript.store';
import type { TranscriptionEnginePort } from '@modules/transcription/application/ports/transcription-engine.port';
import type { TranscriptStorePort } from '@modules/transcription/application/ports/transcript-store.port';

@Module({
  providers: [
    {
      provide: TRANSCRIPTION_ENGINE,
      useFactory: (config: AppConfig, logger: LoggerPort): TranscriptionEnginePort =>
        config.engine === 'gemini'
          ? new GeminiTranscriptionEngine({
              apiKey: config.apiKey,
              models: config.transcribeModels,
              rotateSeconds: config.rotateSeconds,
              silenceDurationMs: config.silenceDurationMs,
              autoDetectLanguages: config.autoDetectLanguages,
              logger,
            })
          : new MockTranscriptionEngine(),
      inject: [APP_CONFIG, LOGGER],
    },
    { provide: TRANSCRIPT_STORE, useFactory: (): TranscriptStorePort => new InMemoryTranscriptStore() },
  ],
  exports: [TRANSCRIPTION_ENGINE, TRANSCRIPT_STORE],
})
export class TranscriptionModule {}
