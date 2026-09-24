import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { LiveSessionService, parseTargets } from '@modules/sessions/application/live-session.service';
import { SessionNotFoundError } from '@modules/sessions/domain/session.errors';
import type { SessionSnapshot } from '@modules/sessions/domain/session.entity';
import { parseLanguage, parseSourceLanguage } from '@shared/language/language';
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

  @Post(':id/stop')
  @HttpCode(200)
  async stop(@Param('id') id: string): Promise<SessionSnapshot> {
    return this.live.stop(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { sourceLanguage?: string; glossaryId?: string },
  ): Promise<SessionSnapshot> {
    let snapshot: SessionSnapshot | undefined;

    if (body.sourceLanguage !== undefined) {
      snapshot = await this.live.changeSourceLanguage(id, parseSourceLanguage(body.sourceLanguage));
    }
    if (body.glossaryId !== undefined) {
      snapshot = await this.live.changeGlossary(id, body.glossaryId);
    }
    if (!snapshot) throw new BadRequestException('nothing to update');
    return snapshot;
  }

  @Post(':id/outputs')
  addOutput(@Param('id') id: string, @Body() body: { language?: string }): SessionSnapshot {
    const raw = body.language?.trim();
    if (!raw) throw new BadRequestException('language is required');
    return this.live.addOutput(id, parseLanguage(raw));
  }

  @Delete(':id/outputs/:language')
  @HttpCode(200)
  removeOutput(@Param('id') id: string, @Param('language') language: string): SessionSnapshot {
    return this.live.removeOutput(id, parseLanguage(language));
  }

  @Delete('ended')
  @HttpCode(200)
  removeEnded(): { removed: number } {
    return { removed: this.live.removeEnded() };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id') id: string): Promise<{ removed: true }> {
    await this.live.remove(id);
    return { removed: true };
  }
}
