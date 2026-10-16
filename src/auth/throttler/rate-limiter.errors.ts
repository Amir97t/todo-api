import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Fail-closed signal for rate-limit storage failures (e.g. Redis outage).
 * The message is static: it must never include the failing key, email,
 * Upstash token/URL, HMAC secret, or any other sensitive value.
 */
export class RateLimiterUnavailableError extends HttpException {
  constructor() {
    super(
      {
        code: 'RATE_LIMITER_UNAVAILABLE',
        message: 'The rate limiter is temporarily unavailable.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
