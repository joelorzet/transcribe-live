import { Controller, Get, Inject } from '@nestjs/common';
import { APP_CONFIG } from '@shared/tokens';
import type { AppConfig } from '@shared/config/env';
import { LiveSessionService } from '@modules/sessions/application/live-session.service';

@Controller('api/health')
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly live: LiveSessionService,
  ) {}

  @Get()
  health(): Record<string, unknown> {
    return {
      status: 'ok',
      engine: this.config.engine,
      models: {
        transcription: this.config.engine === 'gemini' ? this.config.transcribeModels.join(', ') : 'mock',
        translation: this.config.engine === 'gemini' ? this.config.translateModels.join(', ') : 'mock',
      },
      transcriptionMode: this.config.transcriptionMode,
      running: this.live.runningCount,
      capacity: this.config.maxConcurrentSessions,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
