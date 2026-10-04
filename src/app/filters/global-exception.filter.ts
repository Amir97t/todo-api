import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string | string[];
  error: string;
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

const DEFAULT_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

type Constraint = {
  statusCode: number;
  code: string;
};

const PG_CONSTRAINT_MAP: Record<string, Constraint> = {
  '23505': { statusCode: HttpStatus.CONFLICT, code: 'UNIQUE_VIOLATION' },
  '23503': { statusCode: HttpStatus.CONFLICT, code: 'FOREIGN_KEY_VIOLATION' },
  '23502': { statusCode: HttpStatus.BAD_REQUEST, code: 'NOT_NULL_VIOLATION' },
};

const ADAPTER_KIND_MAP: Record<string, Constraint> = {
  UniqueConstraintViolation: {
    statusCode: HttpStatus.CONFLICT,
    code: 'UNIQUE_VIOLATION',
  },
  ForeignKeyConstraintViolation: {
    statusCode: HttpStatus.CONFLICT,
    code: 'FOREIGN_KEY_VIOLATION',
  },
  NullConstraintViolation: {
    statusCode: HttpStatus.BAD_REQUEST,
    code: 'NOT_NULL_VIOLATION',
  },
};

const PRISMA_KNOWN_MAP: Record<string, Constraint> = {
  P2002: { statusCode: HttpStatus.CONFLICT, code: 'UNIQUE_VIOLATION' },
  P2003: { statusCode: HttpStatus.CONFLICT, code: 'FOREIGN_KEY_VIOLATION' },
  P2025: { statusCode: HttpStatus.NOT_FOUND, code: 'RECORD_NOT_FOUND' },
};

function statusText(status: number): string {
  return STATUS_TEXT[status] ?? STATUS_TEXT[HttpStatus.INTERNAL_SERVER_ERROR];
}

function defaultCode(status: number): string {
  return DEFAULT_CODE[status] ?? 'ERROR';
}

function isPrismaKnownError(
  exception: unknown,
): exception is Prisma.PrismaClientKnownRequestError {
  return exception instanceof Prisma.PrismaClientKnownRequestError;
}

/**
 * Prisma nests the driver adapter cause one level deeper than the adapter
 * object itself: meta.driverAdapterError.cause.originalCode.
 */
function adapterConstraint(exception: Prisma.PrismaClientKnownRequestError): {
  originalCode?: string;
  kind?: string;
} {
  const meta = exception.meta as Record<string, unknown> | undefined;
  const adapter = meta?.['driverAdapterError'] as
    | { cause?: { originalCode?: string; kind?: string } }
    | undefined;
  const cause = adapter?.cause;

  return {
    originalCode: typeof cause?.originalCode === 'string' ? cause.originalCode : undefined,
    kind: typeof cause?.kind === 'string' ? cause.kind : undefined,
  };
}

function messageFrom(source: unknown): string | string[] {
  if (typeof source === 'string') return source;
  if (Array.isArray(source)) return source.map(String);
  return 'An unexpected error occurred.';
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${body.code}: ${messageText(body.message)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${body.code}: ${messageText(body.message)}`);
    }

    response.status(body.statusCode).json(body);
  }

  toBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (isPrismaKnownError(exception)) {
      return this.fromPrismaKnownError(exception);
    }

    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'DB_UNAVAILABLE',
        message: 'The database is currently unavailable.',
        error: statusText(HttpStatus.SERVICE_UNAVAILABLE),
      };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: ['Request data failed validation.'],
        error: statusText(HttpStatus.BAD_REQUEST),
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      error: statusText(HttpStatus.INTERNAL_SERVER_ERROR),
    };
  }

  private fromHttpException(exception: HttpException): ErrorBody {
    const statusCode = exception.getStatus();
    const raw = exception.getResponse();

    if (typeof raw === 'string') {
      return {
        statusCode,
        code: defaultCode(statusCode),
        message: raw,
        error: statusText(statusCode),
      };
    }

    const fields = raw as Record<string, unknown>;
    const message = fields['message'];
    const code =
      typeof fields['code'] === 'string'
        ? fields['code']
        : Array.isArray(message)
          ? 'VALIDATION_ERROR'
          : defaultCode(statusCode);

    return {
      statusCode,
      code,
      message: messageFrom(message),
      error:
        typeof fields['error'] === 'string'
          ? fields['error']
          : statusText(statusCode),
    };
  }

  private fromPrismaKnownError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): ErrorBody {
    const { originalCode, kind } = adapterConstraint(exception);

    const constraint =
      (originalCode !== undefined ? PG_CONSTRAINT_MAP[originalCode] : undefined) ??
      (kind !== undefined ? ADAPTER_KIND_MAP[kind] : undefined) ??
      PRISMA_KNOWN_MAP[exception.code];

    if (constraint) {
      return {
        statusCode: constraint.statusCode,
        code: constraint.code,
        message: publicMessage(constraint.code),
        error: statusText(constraint.statusCode),
      };
    }

    // P2010 (raw query failure) or any other known-request error without a
    // recognised constraint: never surface the underlying SQL or adapter cause.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      error: statusText(HttpStatus.INTERNAL_SERVER_ERROR),
    };
  }
}

function publicMessage(code: string): string {
  switch (code) {
    case 'UNIQUE_VIOLATION':
      return 'That value is already in use.';
    case 'FOREIGN_KEY_VIOLATION':
      return 'The referenced record does not exist or is still in use.';
    case 'NOT_NULL_VIOLATION':
      return 'A required value was missing.';
    case 'RECORD_NOT_FOUND':
      return 'The requested record was not found.';
    default:
      return 'An unexpected error occurred.';
  }
}

function messageText(message: string | string[]): string {
  return Array.isArray(message) ? message.join('; ') : message;
}
