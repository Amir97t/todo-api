import { BadRequestException, ConflictException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter.js';
import { Prisma } from '../../generated/prisma/client.js';

const filter = new GlobalExceptionFilter();

function knownError(
  code: string,
  meta?: Record<string, unknown>,
  message = 'prisma failure',
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: '7.10.0',
    meta,
  });
}

const adapterMeta = (originalCode: string, kind: string) => ({
  driverAdapterError: {
    name: 'DriverAdapterError',
    cause: { originalCode, kind },
  },
});

describe('GlobalExceptionFilter', () => {
  it('maps model-level P2002 to 409 UNIQUE_VIOLATION', () => {
    const body = filter.toBody(knownError('P2002', adapterMeta('23505', 'UniqueConstraintViolation')));

    expect(body).toEqual({
      statusCode: 409,
      code: 'UNIQUE_VIOLATION',
      message: 'That value is already in use.',
      error: 'Conflict',
    });
  });

  it('maps model-level P2003 to 409 FOREIGN_KEY_VIOLATION', () => {
    const body = filter.toBody(knownError('P2003', adapterMeta('23503', 'ForeignKeyConstraintViolation')));

    expect(body).toEqual({
      statusCode: 409,
      code: 'FOREIGN_KEY_VIOLATION',
      message: 'The referenced record does not exist or is still in use.',
      error: 'Conflict',
    });
  });

  it('maps P2025 to 404 RECORD_NOT_FOUND', () => {
    const body = filter.toBody(knownError('P2025'));

    expect(body).toEqual({
      statusCode: 404,
      code: 'RECORD_NOT_FOUND',
      message: 'The requested record was not found.',
      error: 'Not Found',
    });
  });

  it('maps raw-query P2010 with adapter cause 23503 to 409', () => {
    const body = filter.toBody(
      knownError('P2010', adapterMeta('23503', 'ForeignKeyConstraintViolation')),
    );

    expect(body.code).toBe('FOREIGN_KEY_VIOLATION');
    expect(body.statusCode).toBe(409);
  });

  it('maps raw-query P2010 with adapter cause 23505 to 409', () => {
    const body = filter.toBody(
      knownError('P2010', adapterMeta('23505', 'UniqueConstraintViolation')),
    );

    expect(body.code).toBe('UNIQUE_VIOLATION');
    expect(body.statusCode).toBe(409);
  });

  it('maps raw-query P2010 with adapter cause 23502 to 400', () => {
    const body = filter.toBody(
      knownError('P2010', adapterMeta('23502', 'NullConstraintViolation')),
    );

    expect(body).toEqual({
      statusCode: 400,
      code: 'NOT_NULL_VIOLATION',
      message: 'A required value was missing.',
      error: 'Bad Request',
    });
  });

  it('maps DB connection failures to 503 DB_UNAVAILABLE', () => {
    const error = new Prisma.PrismaClientInitializationError(
      'Can not reach database server',
      { clientVersion: '7.10.0' },
    );

    expect(filter.toBody(error)).toEqual({
      statusCode: 503,
      code: 'DB_UNAVAILABLE',
      message: 'The database is currently unavailable.',
      error: 'Service Unavailable',
    });
  });

  it('maps validation pipe rejections to 400 VALIDATION_ERROR with a list', () => {
    const body = filter.toBody(
      new BadRequestException({
        statusCode: 400,
        message: ['name must not be empty'],
        error: 'Bad Request',
      }),
    );

    expect(body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: ['name must not be empty'],
      error: 'Bad Request',
    });
  });

  it('keeps an explicit code from a domain exception', () => {
    const body = filter.toBody(
      new ConflictException({
        code: 'LIST_PROTECTED',
        message: 'Inbox cannot be renamed.',
      }),
    );

    expect(body).toEqual({
      statusCode: 409,
      code: 'LIST_PROTECTED',
      message: 'Inbox cannot be renamed.',
      error: 'Conflict',
    });
  });

  it('never leaks SQL, stacks, or adapter internals', () => {
    const sql = 'INSERT INTO "List"("id","name") VALUES (1,2)';
    const raw = knownError(
      'P2010',
      {
        ...adapterMeta('23503', 'ForeignKeyConstraintViolation'),
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '23503',
            kind: 'ForeignKeyConstraintViolation',
            originalMessage: 'violates foreign key constraint "Task_listId_fkey"',
          },
        },
      },
      `Raw query failed. ${sql}`,
    );

    const body = filter.toBody(raw);
    const serialised = JSON.stringify(body);

    expect(serialised).not.toContain(sql);
    expect(serialised).not.toContain('Task_listId_fkey');
    expect(serialised).not.toContain('driverAdapterError');
    expect(serialised).not.toContain('originalCode');
  });

  it('returns a generic 500 for unknown errors without leaking the message', () => {
    const body = filter.toBody(
      new Error('SELECT * FROM "List" WHERE secret = 1'),
    );

    expect(body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      error: 'Internal Server Error',
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('falls back to a generic 500 for recognised Prisma errors with no known constraint', () => {
    const body = filter.toBody(knownError('P2010', {
      driverAdapterError: { name: 'DriverAdapterError', cause: { originalCode: '99999', kind: 'SomethingElse' } },
    }));

    expect(body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      error: 'Internal Server Error',
    });
  });
});
