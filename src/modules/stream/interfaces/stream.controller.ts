import { Controller, Get, Header, Inject, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionNotFoundError } from '@modules/sessions/domain/session.errors';
import { findTranslation } from '@modules/transcription/domain/transcript.entity';
import { splitIntoCaptions } from '@modules/transcription/domain/caption-splitter';
import { isLanguageCode } from '@shared/language/language';
import type { LanguageCode } from '@shared/language/language';
import { EVENT_PUBLISHER, SESSION_REPOSITORY, TRANSCRIPT_STORE } from '@shared/tokens';
import type { EventPublisherPort } from '@modules/events/application/ports/event-publisher.port';
import type { SessionRepositoryPort } from '@modules/sessions/application/ports/session.repository.port';
import type { TranscriptStorePort } from '@modules/transcription/application/ports/transcript-store.port';

const KEEPALIVE_MS = 15000;

@Controller('api/sessions/:id')
export class StreamController {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(TRANSCRIPT_STORE) private readonly transcripts: TranscriptStorePort,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
  ) {}

  @Get('events')
  events(
    @Param('id') id: string,
    @Query('lang') lang: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): void {
    if (!this.sessions.find(id)) throw new SessionNotFoundError(id);
    const language = this.#language(lang);

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
      'x-accel-buffering': 'no',
    });
    response.write(`retry: 2000\n\n`);

    const send = (event: string, payload: unknown): void => {
      response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    for (const segment of this.transcripts.recent(id, 5)) {
      const text = language ? findTranslation(segment, language) : segment.text;
      if (text) send('caption', this.#toCaption(text, segment, language));
    }

    const unsubscribe = this.publisher.subscribe(id, (event) => {
      if (event.type === 'segment.interim' && !language) {
        send('interim', { text: event.text, language: event.language });
      } else if (event.type === 'segment.final' && !language) {
        send('caption', this.#toCaption(event.segment.text, event.segment, undefined));
      } else if (event.type === 'segment.translated' && event.translation.language === language) {
        send('caption', {
          text: event.translation.text,
          lines: splitIntoCaptions(event.translation.text),
          language: event.translation.language,
          seq: event.seq,
        });
      } else if (event.type === 'session.ended') {
        send('ended', { sessionId: id });
      }
    });

    const keepalive = setInterval(() => response.write(': keepalive\n\n'), KEEPALIVE_MS);

    const close = (): void => {
      clearInterval(keepalive);
      unsubscribe();
      response.end();
    };
    request.on('close', close);
    response.on('error', close);
  }

  @Get('live.txt')
  @Header('content-type', 'text/plain; charset=utf-8')
  @Header('cache-control', 'no-store')
  @Header('access-control-allow-origin', '*')
  liveText(@Param('id') id: string, @Query('lang') lang: string | undefined): string {
    if (!this.sessions.find(id)) throw new SessionNotFoundError(id);
    const language = this.#language(lang);

    const [latest] = this.transcripts.recent(id, 1);
    if (!latest) return '';

    const text = language ? findTranslation(latest, language) : latest.text;
    if (!text) return '';

    const lines = splitIntoCaptions(text);
    return lines.slice(-2).join('\n');
  }

  #language(raw: string | undefined): LanguageCode | undefined {
    const value = raw?.trim().toLowerCase() ?? '';
    return isLanguageCode(value) ? value : undefined;
  }

  #toCaption(
    text: string,
    segment: { seq: number; language: string; latencyMs: number },
    language: LanguageCode | undefined,
  ): Record<string, unknown> {
    return {
      text,
      lines: splitIntoCaptions(text),
      language: language ?? segment.language,
      seq: segment.seq,
      latencyMs: segment.latencyMs,
    };
  }
}
