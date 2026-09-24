import { Module } from '@nestjs/common';
import type { AppConfig } from '@shared/config/env';
import type { LoggerPort } from '@shared/ports/system.port';
import { APP_CONFIG, LOGGER, TRANSLATOR } from '@shared/tokens';
import { GeminiTranslator } from '@modules/translation/infrastructure/gemini/gemini-translator.adapter';
import { MockTranslator } from '@modules/translation/infrastructure/mock/mock-translator.adapter';
import type { TranslatorPort } from '@modules/translation/application/ports/translator.port';

@Module({
  providers: [
    {
      provide: TRANSLATOR,
      useFactory: (config: AppConfig, logger: LoggerPort): TranslatorPort =>
        config.engine === 'gemini'
          ? new GeminiTranslator({ apiKey: config.apiKey, model: config.translateModel, logger })
          : new MockTranslator(),
      inject: [APP_CONFIG, LOGGER],
    },
  ],
  exports: [TRANSLATOR],
})
export class TranslationModule {}
