import type { SessionSnapshot } from '@modules/sessions/domain/session.entity';
import type { TranscriptSegment, Translation } from '@modules/transcription/domain/transcript.entity';
import type { LanguageCode } from '@shared/language/language';

export type SessionEvent =
  | { type: 'session.started'; session: SessionSnapshot }
  | { type: 'session.stats'; session: SessionSnapshot }
  | { type: 'session.ended'; session: SessionSnapshot }
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
