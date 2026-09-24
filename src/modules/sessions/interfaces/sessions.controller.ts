import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common';
import { LiveSessionService, parseTargets } from '@modules/sessions/application/live-session.service';
import { SessionNotFoundError } from '@modules/sessions/domain/session.errors';
import type { SessionSnapshot } from '@modules/sessions/domain/session.entity';
import { parseSourceLanguage } from '@shared/language/language';
import { SESSION_REPOSITORY, APP_CONFIG } from '@shared/tokens';
import type { SessionRepositoryPort } from '@modules/sessions/application/ports/session.repository.port';
import type { AppConfig } from '@shared/config/env';

interface CreateSessionBody {
  id?: string;
  title?: string;
  sourceLanguage?: string;
  targetLanguages?: string;
  glossaryId?: string;
}

@Controller('api/sessions')
export class SessionsController {
  constructor(
    private readonly live: LiveSessionService,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post()
  async create(@Body() body: CreateSessionBody): Promise<SessionSnapshot> {
    const title = body.title?.trim();
    if (!title) throw new BadRequestException('title is required');

    try {
      return await this.live.start({
        id: body.id,
        title,
        sourceLanguage: parseSourceLanguage(body.sourceLanguage ?? 'auto'),
        targetLanguages: parseTargets(body.targetLanguages, ['en']),
        glossaryId: body.glossaryId ?? 'none',
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get()
  list(): { engine: string; capacity: number; running: number; sessions: SessionSnapshot[] } {
    return {
      engine: this.config.engine,
      capacity: this.config.maxConcurrentSessions,
      running: this.live.runningCount,
      sessions: this.live.listSnapshots(),
    };
  }

  @Get(':id')
  get(@Param('id') id: string): SessionSnapshot {
    const session = this.sessions.find(id);
    if (!session) throw new SessionNotFoundError(id);
    return this.live.snapshot(session);
  }

  @Delete(':id')
  async stop(@Param('id') id: string): Promise<SessionSnapshot> {
    return this.live.stop(id);
  }
}
