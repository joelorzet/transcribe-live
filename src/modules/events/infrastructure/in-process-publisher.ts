import { CONTROL_ROOM, type EventHandler, type EventPublisherPort, type SessionEvent } from '@modules/events/application/ports/event-publisher.port';

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

  subscriberCount(sessionId: string): number {
    return this.#topics.get(sessionId)?.size ?? 0;
  }
}
