import { Module } from '@nestjs/common';
import { MediaIngestService } from '@modules/ingest/application/media-ingest.service';
import { IngestController } from '@modules/ingest/interfaces/ingest.controller';
import { SessionsModule } from '@modules/sessions/sessions.module';
import { LiveSessionService } from '@modules/sessions/application/live-session.service';
import { LOGGER } from '@shared/tokens';
import type { LoggerPort } from '@shared/ports/system.port';

@Module({
  imports: [SessionsModule],
  controllers: [IngestController],
  providers: [
    {
      provide: MediaIngestService,
      useFactory: (live: LiveSessionService, logger: LoggerPort): MediaIngestService =>
        new MediaIngestService(live, logger),
      inject: [LiveSessionService, LOGGER],
    },
  ],
  exports: [MediaIngestService],
})
export class IngestModule {}
