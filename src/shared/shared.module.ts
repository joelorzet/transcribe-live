import { Global, Module } from '@nestjs/common';
import { loadConfig } from '@shared/config/env';
import type { AppConfig } from '@shared/config/env';
import { ConsoleLogger } from '@shared/logging/console-logger';
import type { ClockPort, LoggerPort } from '@shared/ports/system.port';
import { APP_CONFIG, CLOCK, LOGGER } from '@shared/tokens';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() },
    {
      provide: LOGGER,
      useFactory: (config: AppConfig): LoggerPort => new ConsoleLogger(config.logLevel),
      inject: [APP_CONFIG],
    },
    { provide: CLOCK, useValue: { now: (): number => Date.now() } satisfies ClockPort },
  ],
  exports: [APP_CONFIG, LOGGER, CLOCK],
})
export class SharedModule {}
