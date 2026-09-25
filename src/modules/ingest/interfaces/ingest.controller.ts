import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { MediaIngestService } from '@modules/ingest/application/media-ingest.service';
import type { IngestStatus } from '@modules/ingest/application/media-ingest.service';
import { SessionNotFoundError } from '@modules/sessions/domain/session.errors';
import { LiveSessionService } from '@modules/sessions/application/live-session.service';
import { SESSION_REPOSITORY } from '@shared/tokens';
import type { SessionRepositoryPort } from '@modules/sessions/application/ports/session.repository.port';

interface StartIngestBody {
  source?: string;
  startSeconds?: number;
  durationSeconds?: number;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'rtmp:', 'rtmps:', 'udp:', 'tcp:']);

@Controller('api/sessions/:id/ingest')
export class IngestController {
  constructor(
    private readonly ingest: MediaIngestService,
    private readonly live: LiveSessionService,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
  ) {}

  /**
   * Attaching a source to a stopped track is a request to run it again. Without
   * this, opening an endpoint on a stopped room appeared to work and then threw
   * every chunk away, because the session was no longer accepting audio.
   */
  async #ensureRunning(id: string): Promise<void> {
    const session = this.sessions.find(id);
    if (!session) throw new SessionNotFoundError(id);
    if (!session.isActive) await this.live.restart(id);
  }

  @Post()
  async start(@Param('id') id: string, @Body() body: StartIngestBody): Promise<IngestStatus> {
    await this.#ensureRunning(id);

    const source = body.source?.trim();
    if (!source) throw new BadRequestException('source is required');

    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new BadRequestException('source must be an http(s) URL');
    }
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      throw new BadRequestException('source must be an http(s) URL');
    }

    return this.ingest.start({
      trackId: id,
      source,
      startSeconds: toPositiveNumber(body.startSeconds),
      durationSeconds: toPositiveNumber(body.durationSeconds),
    });
  }

  @Post('rtmp')
  async startRtmp(@Param('id') id: string, @Req() request: Request): Promise<IngestStatus> {
    await this.#ensureRunning(id);
    const host = (request.headers.host ?? 'localhost').replace(/:\d+$/, '');
    return this.ingest.startRtmp(id, host);
  }

  /**
   * Pipes the published stream out as HTTP-FLV so a browser can watch what
   * production is sending. Proxied rather than linked directly: the media
   * server addresses streams by their publish key, and handing that to the
   * room would let anyone publish into the talk.
   */
  @Get('stream.flv')
  async playback(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const url = this.ingest.playbackUrl(id);
    if (!url) throw new NotFoundException('This track has no live video');

    const upstream = await fetch(url).catch(() => null);
    if (!upstream?.ok || !upstream.body) {
      throw new NotFoundException('The live video is not available yet');
    }

    response.setHeader('content-type', 'video/x-flv');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('access-control-allow-origin', '*');

    const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    stream.pipe(response);
    response.on('close', () => stream.destroy());
  }

  @Get()
  status(@Param('id') id: string): { ingest: IngestStatus | null } {
    return { ingest: this.ingest.status(id) ?? null };
  }

  @Delete()
  stop(@Param('id') id: string): { stopped: true } {
    this.ingest.stop(id);
    return { stopped: true };
  }
}

function toPositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
