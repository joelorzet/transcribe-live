import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
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
