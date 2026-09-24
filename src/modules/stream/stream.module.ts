import { Module } from '@nestjs/common';
import { StreamController } from '@modules/stream/interfaces/stream.controller';
import { SessionsModule } from '@modules/sessions/sessions.module';
import { TranscriptionModule } from '@modules/transcription/transcription.module';
import { EventsModule } from '@modules/events/events.module';

@Module({
  imports: [SessionsModule, TranscriptionModule, EventsModule],
  controllers: [StreamController],
})
export class StreamModule {}
