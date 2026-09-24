import { Controller, Get, Header, Inject, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { toJson, toPlainText, toSrt, toVtt } from '@modules/export/application/subtitles.service';
import { SessionNotFoundError } from '@modules/sessions/domain/session.errors';
import { isLanguageCode } from '@shared/language/language';
import type { LanguageCode } from '@shared/language/language';
import { SESSION_REPOSITORY, TRANSCRIPT_STORE } from '@shared/tokens';
import type { SessionRepositoryPort } from '@modules/sessions/application/ports/session.repository.port';
import type { TranscriptStorePort } from '@modules/transcription/application/ports/transcript-store.port';

const MEDIA_TYPES: Record<string, string> = {
  srt: 'application/x-subrip; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

@Controller('api/sessions/:id/transcript')
export class TranscriptController {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(TRANSCRIPT_STORE) private readonly transcripts: TranscriptStorePort,
  ) {}

  @Get()
  @Header('cache-control', 'no-store')
  download(
    @Param('id') id: string,
    @Query('format') format = 'srt',
    @Query('lang') lang: string | undefined,
    @Res() response: Response,
  ): void {
    const session = this.sessions.find(id);
    if (!session) throw new SessionNotFoundError(id);

    const segments = this.transcripts.finals(id);
    const language: LanguageCode | undefined = lang && isLanguageCode(lang) ? lang : undefined;
    const normalised = MEDIA_TYPES[format] ? format : 'srt';

    const body =
      normalised === 'vtt'
        ? toVtt(segments, language)
        : normalised === 'txt'
          ? toPlainText(segments, language)
          : normalised === 'json'
            ? toJson(segments)
            : toSrt(segments, language);

    const suffix = language ? `.${language}` : '';
    response
      .status(200)
      .setHeader('content-type', MEDIA_TYPES[normalised] as string)
      .setHeader('content-disposition', `attachment; filename="${id}${suffix}.${normalised}"`)
      .send(body);
  }
}
