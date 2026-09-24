import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import { AppModule } from './app.module';
import { RealtimeGateway } from '@modules/realtime/interfaces/realtime.gateway';
import { LiveSessionService } from '@modules/sessions/application/live-session.service';
import { MediaIngestService } from '@modules/ingest/application/media-ingest.service';
import { DomainExceptionFilter } from '@shared/errors/domain-exception.filter';
import { APP_CONFIG, LOGGER } from '@shared/tokens';
import type { AppConfig } from '@shared/config/env';
import type { LoggerPort } from '@shared/ports/system.port';

const STATS_INTERVAL_MS = 1000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['warn', 'error'], bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = app.get<LoggerPort>(LOGGER);

  app.enableCors({ origin: true, credentials: true });
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

  const live = app.get(LiveSessionService);
  const stats = setInterval(() => live.publishStats(), STATS_INTERVAL_MS);
  stats.unref();

  await app.listen(config.port, config.host);
  app.get(RealtimeGateway).bind(app.getHttpServer() as Server);

  if (config.engine === 'mock') {
    logger.warn('running with the MOCK engine: set GEMINI_API_KEY and ENGINE=gemini for real transcription');
  }
  logger.info('core-api listening', {
    url: `http://${config.host}:${config.port}`,
    engine: config.engine,
    transcription: config.engine === 'gemini' ? config.transcribeModels.join(', ') : 'mock',
    translation: config.engine === 'gemini' ? config.translateModels.join(', ') : 'mock',
    capacity: config.maxConcurrentSessions,
  });

  const shutdown = async (): Promise<void> => {
    clearInterval(stats);
    app.get(MediaIngestService).shutdown();
    await live.shutdown();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void bootstrap();
