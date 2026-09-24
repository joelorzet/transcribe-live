import { Module } from '@nestjs/common';
import { RealtimeGateway } from '@modules/realtime/interfaces/realtime.gateway';
import { SessionsModule } from '@modules/sessions/sessions.module';
import { TranscriptionModule } from '@modules/transcription/transcription.module';
import { EventsModule } from '@modules/events/events.module';

@Module({
  imports: [SessionsModule, TranscriptionModule, EventsModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
