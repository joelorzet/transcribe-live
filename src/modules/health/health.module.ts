import { Module } from '@nestjs/common';
import { HealthController } from '@modules/health/health.controller';
import { SessionsModule } from '@modules/sessions/sessions.module';

@Module({ imports: [SessionsModule], controllers: [HealthController] })
export class HealthModule {}
