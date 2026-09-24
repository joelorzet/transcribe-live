import { Module } from '@nestjs/common';
import { SharedModule } from '@shared/shared.module';
import { EventsModule } from '@modules/events/events.module';
import { GlossaryModule } from '@modules/glossary/glossary.module';
import { TranscriptionModule } from '@modules/transcription/transcription.module';
import { TranslationModule } from '@modules/translation/translation.module';
import { SessionsModule } from '@modules/sessions/sessions.module';
import { RealtimeModule } from '@modules/realtime/realtime.module';
import { ExportModule } from '@modules/export/export.module';
import { IngestModule } from '@modules/ingest/ingest.module';
import { HealthModule } from '@modules/health/health.module';

@Module({
  imports: [
    SharedModule,
    EventsModule,
    GlossaryModule,
    TranscriptionModule,
    TranslationModule,
    SessionsModule,
    RealtimeModule,
    ExportModule,
    IngestModule,
    HealthModule,
  ],
})
export class AppModule {}
