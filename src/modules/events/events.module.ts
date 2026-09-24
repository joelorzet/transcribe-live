import { Module } from '@nestjs/common';
import { EVENT_PUBLISHER } from '@shared/tokens';
import { InProcessEventPublisher } from '@modules/events/infrastructure/in-process-publisher';
import type { EventPublisherPort } from '@modules/events/application/ports/event-publisher.port';

@Module({
  providers: [{ provide: EVENT_PUBLISHER, useFactory: (): EventPublisherPort => new InProcessEventPublisher() }],
  exports: [EVENT_PUBLISHER],
})
export class EventsModule {}
