import { DomainError } from '@shared/errors/domain.errors';

export class SessionNotFoundError extends DomainError {
  constructor(id: string) {
    super('session_not_found', `No session with id "${id}"`, 404);
  }
}

export class SessionAlreadyExistsError extends DomainError {
  constructor(id: string) {
    super('session_exists', `Session "${id}" already exists`, 409);
  }
}

export class InvalidSessionStateError extends DomainError {
  constructor(message: string) {
    super('invalid_state', message, 409);
  }
}

export class CapacityExceededError extends DomainError {
  constructor(limit: number) {
    super('capacity_exceeded', `Server is at capacity (${limit} concurrent sessions)`, 503);
  }
}
