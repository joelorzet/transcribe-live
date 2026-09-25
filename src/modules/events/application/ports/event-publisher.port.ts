import type { SessionSnapshot } from '@modules/sessions/domain/session.entity';
import type { TranscriptSegment, Translation } from '@modules/transcription/domain/transcript.entity';
import type { LanguageCode } from '@shared/language/language';

/**
 * What a member of the audience is allowed to know about a talk. Deliberately
 * not a SessionSnapshot: cost, token counts and per output latency windows are
 * the production team's business and have no place on a public page.
 */
export interface AudienceView {
  id: string;
  title: string;
  status: string;
  spokenLanguage: string;
  languages: LanguageCode[];
  /** Where the server is in the source, so a player can line up with it. */
  positionSeconds?: number;
  /** Typical speech to caption delay, used to offset the picture. */
  captionLagMs: number;
  hasAudio: boolean;
  waitingForPublisher: boolean;
  watchUrl?: string;
  /** Set when the talk is being pushed to us and can be played back. */
  streamPath?: string;
}

export type SessionEvent =
  | { type: 'session.started'; session: SessionSnapshot }
  | { type: 'session.stats'; session: SessionSnapshot }
  | { type: 'session.ended'; session: SessionSnapshot }
  | { type: 'session.view'; session: AudienceView }
  | {
      type: 'segment.interim';
      sessionId: string;
      text: string;
      language: LanguageCode;
      at: number;
    }
  | { type: 'segment.final'; sessionId: string; segment: TranscriptSegment }
  | {
      type: 'segment.translated';
      sessionId: string;
      segmentId: string;
      seq: number;
      translation: Translation;
    };

export type EventHandler = (event: SessionEvent) => void;

export const CONTROL_ROOM = '*';

export interface EventPublisherPort {
  publish(sessionId: string, event: SessionEvent): void;
  subscribe(sessionId: string, handler: EventHandler): () => void;
  subscriberCount(sessionId: string): number;
}
