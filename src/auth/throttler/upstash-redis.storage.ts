import { ThrottlerStorage } from '@nestjs/throttler';
// The record type is not re-exported from the package root in v6.7.1, so
// this type-only (compile-time-erased) deep import targets the library's
// own interface module. `.js` suffix satisfies nodenext resolution.
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import { RateLimiterUnavailableError } from './rate-limiter.errors.js';

/**
 * Fixed-window counter executed as a single atomic Redis EVAL.
 *
 * INCR and PEXPIRE run inside one Lua script, so the window TTL is set only
 * when the counter is created (first hit) and can never be separated from —
 * or race with — the increment. Later hits (including blocked retries) never
 * touch the TTL, so the window cannot be extended.
 *
 * Returns { totalHits, PTTL-milliseconds }:
 *   KEYS[1] = bucket key
 *   ARGV[1] = window TTL in milliseconds
 */
export const FIXED_WINDOW_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { n, redis.call('PTTL', KEYS[1]) }
`;

/**
 * Minimal structural view of the @upstash/redis client's `eval` command,
 * so the storage can be unit-tested with a fake client.
 */
export interface UpstashEvalClient {
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}

/**
 * ThrottlerStorage backed by Upstash Redis (shared counters across
 * serverless instances).
 *
 * Implements the exact @nestjs/throttler v6 contract:
 *   increment(key, ttlMs, limit, blockDurationMs, throttlerName)
 *     -> { totalHits, timeToExpire, isBlocked, timeToBlockExpire }
 *
 * Time units follow the library's MemoryStorage reference:
 *   - `ttl` / `blockDuration` inputs are milliseconds.
 *   - `timeToExpire` / `timeToBlockExpire` outputs are seconds,
 *     rounded up (Math.ceil) exactly like MemoryStorage.
 *
 * `blockDuration` is honored as tied to the fixed window (the block expires
 * with the window); the configured auth limits use the library default
 * blockDuration === ttl, so this matches the reference behavior. Blocked
 * requests never extend the window: the Lua script only sets TTL on the
 * first hit of a window.
 *
 * Failure semantics are fail-closed: any Redis error (or a malformed script
 * result) throws RateLimiterUnavailableError (503) and never falls back to
 * an in-process counter.
 */
export class UpstashRedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: UpstashEvalClient) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    let result: unknown;
    try {
      result = await this.redis.eval(FIXED_WINDOW_SCRIPT, [key], [ttl]);
    } catch {
      throw new RateLimiterUnavailableError();
    }

    if (!Array.isArray(result) || result.length < 2) {
      throw new RateLimiterUnavailableError();
    }

    const totalHits = Number(result[0]);
    const pttlMs = Number(result[1]);
    if (!Number.isFinite(totalHits) || !Number.isFinite(pttlMs)) {
      throw new RateLimiterUnavailableError();
    }

    const timeToExpire = Math.max(0, Math.ceil(pttlMs / 1000));
    const isBlocked = totalHits > limit;

    return {
      totalHits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? timeToExpire : 0,
    };
  }
}
