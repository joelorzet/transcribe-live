import { CONTROL_ROOM, type EventHandler, type EventPublisherPort, type SessionEvent } from '../../application/ports/events.ts';

/**
 * Topic-based fan-out. Every event goes to that session's subscribers and to
 * the control-room channel, so the dashboard sees all tracks over one socket
 * instead of opening one connection per track.
 */
export class InProcessEventPublisher implements EventPublisherPort {
  readonly #topics = new Map<string, Set<EventHandler>>();

  publish(sessionId: string, event: SessionEvent): void {
    this.#emit(sessionId, event);
    this.#emit(CONTROL_ROOM, event);
  }

  #emit(topic: string, event: SessionEvent): void {
    const handlers = this.#topics.get(topic);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(event);
      } catch {
        // A broken viewer must never take down the ingest path.
      }
    }
  }

  subscribe(sessionId: string, handler: EventHandler): () => void {
    const handlers = this.#topics.get(sessionId) ?? new Set<EventHandler>();
    handlers.add(handler);
    this.#topics.set(sessionId, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.#topics.delete(sessionId);
    };
  }

  /** Control-room subscribers are observers, not audience; excluded from counts. */
  subscriberCount(sessionId: string): number {
    return this.#topics.get(sessionId)?.size ?? 0;
  }
}
