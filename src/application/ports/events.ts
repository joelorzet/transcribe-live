import type { SessionSnapshot } from '../../domain/session.ts';
import type { TranscriptSegment, Translation } from '../../domain/transcript.ts';
import type { LanguageCode } from '../../domain/language.ts';

/**
 * The wire contract between the server and every viewer (web page, OBS
 * overlay, terminal client). Kept flat and JSON-friendly on purpose.
 */
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

/** Channel that carries every session's lifecycle + stats to the control room. */
export const CONTROL_ROOM = '*';

export interface EventPublisherPort {
  /** Fan out to subscribers of `sessionId` and to the control room. */
  publish(sessionId: string, event: SessionEvent): void;
  /** Subscribe to one session, or to CONTROL_ROOM for all of them. */
  subscribe(sessionId: string, handler: EventHandler): () => void;
  subscriberCount(sessionId: string): number;
}
