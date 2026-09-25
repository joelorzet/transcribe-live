import { Module } from '@nestjs/common';
import { MediaIngestService } from '@modules/ingest/application/media-ingest.service';
import { RtmpRelay } from '@modules/ingest/infrastructure/rtmp-relay';
import { IngestController } from '@modules/ingest/interfaces/ingest.controller';
import { SessionsModule } from '@modules/sessions/sessions.module';
import { LiveSessionService } from '@modules/sessions/application/live-session.service';
import { APP_CONFIG, INPUT_REGISTRY, LOGGER } from '@shared/tokens';
import type { InputRegistry } from '@shared/input/input-registry';
import type { AppConfig } from '@shared/config/env';
import type { LoggerPort } from '@shared/ports/system.port';

function buildIngestService(
  live: LiveSessionService,
  logger: LoggerPort,
  config: AppConfig,
  registry: InputRegistry,
): MediaIngestService {
  let service: MediaIngestService;
  const relay = new RtmpRelay(config.rtmpPort, config.rtmpHttpPort, logger, {
    onPublish: (trackId, pullUrl) => service.attachPublisher(trackId, pullUrl),
    onUnpublish: (trackId) => service.detachPublisher(trackId),
  });

  service = new MediaIngestService(
    live,
    logger,
    { host: config.rtmpHost, port: config.rtmpPort },
    registry,
    relay,
  );
  return service;
}

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
        registry: InputRegistry,
      ): MediaIngestService =>
        buildIngestService(live, logger, config, registry),
      inject: [LiveSessionService, LOGGER, APP_CONFIG, INPUT_REGISTRY],
    },
  ],
  exports: [MediaIngestService],
})
export class IngestModule {}
