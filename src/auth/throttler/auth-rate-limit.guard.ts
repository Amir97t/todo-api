import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Auth rate-limit guard: ThrottlerGuard with the project's error contract.
 * 429 responses use { code: 'RATE_LIMITED' } so clients and the global
 * exception filter share one machine-readable shape.
 *
 * Storage outages surface as RateLimiterUnavailableError (503, fail-closed)
 * thrown by the storage layer; this guard deliberately does not catch it.
 */
@Injectable()
export class AuthRateLimitGuard extends ThrottlerGuard {
  protected async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      { code: 'RATE_LIMITED', message: 'Too many requests.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
