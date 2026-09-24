import { Module } from '@nestjs/common';
import { MediaIngestService } from '@modules/ingest/application/media-ingest.service';
import { IngestController } from '@modules/ingest/interfaces/ingest.controller';
import { SessionsModule } from '@modules/sessions/sessions.module';
import { LiveSessionService } from '@modules/sessions/application/live-session.service';
import { APP_CONFIG, LOGGER } from '@shared/tokens';
import type { AppConfig } from '@shared/config/env';
import type { LoggerPort } from '@shared/ports/system.port';

@Module({
  imports: [SessionsModule],
  controllers: [IngestController],
  providers: [
    {
      provide: MediaIngestService,
      useFactory: (
        live: LiveSessionService,
        logger: LoggerPort,
        config: AppConfig,
      ): MediaIngestService =>
        new MediaIngestService(live, logger, {
          host: config.rtmpHost,
          basePort: config.rtmpBasePort,
          waitSeconds: config.rtmpWaitSeconds,
        }),
      inject: [LiveSessionService, LOGGER, APP_CONFIG],
    },
  ],
  exports: [MediaIngestService],
})
export class IngestModule {}
