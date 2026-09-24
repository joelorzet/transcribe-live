import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '@shared/errors/domain.errors';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      response.status(exception.status).json({ error: exception.code, message: exception.message });
      return;
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response.status(exception.getStatus()).json(
        typeof body === 'string' ? { error: 'http_error', message: body } : body,
      );
      return;
    }

    const message = exception instanceof Error ? exception.message : 'Unexpected error';
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'internal_error', message });
  }
}
