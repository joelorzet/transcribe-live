import { Module } from '@nestjs/common';
import { TranscriptController } from '@modules/export/interfaces/transcript.controller';
import { SessionsModule } from '@modules/sessions/sessions.module';
import { TranscriptionModule } from '@modules/transcription/transcription.module';

@Module({
  imports: [SessionsModule, TranscriptionModule],
  controllers: [TranscriptController],
})
export class ExportModule {}
