import { describe, it, expect } from 'vitest';
import {
  FIXED_WINDOW_SCRIPT,
  UpstashRedisThrottlerStorage,
  type UpstashEvalClient,
} from '../../src/auth/throttler/upstash-redis.storage.js';
import { RateLimiterUnavailableError } from '../../src/auth/throttler/rate-limiter.errors.js';

interface FakeEntry {
  count: number;
  expiresAt: number;
}

/**
 * In-memory fake that emulates the FIXED_WINDOW_SCRIPT contract against a
 * controllable clock: INCR, PEXPIRE only when the counter is created,
 * PTTL read. Records every eval call so the suite can assert the exact
 * script/keys/args and that TTL is initialized exactly once per window.
 */
class FakeRedis implements UpstashEvalClient {
  store = new Map<string, FakeEntry>();
  now = 0;
  pexpireCalls = 0;
  evalCalls: Array<{ script: string; keys: string[]; args: (string | number)[] }> = [];
  failNext = false;
  malformedResult: unknown = undefined;

  async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    this.evalCalls.push({ script, keys, args });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('connection refused');
    }
    if (this.malformedResult !== undefined) {
      return this.malformedResult;
    }
    const key = keys[0];
    const ttlMs = Number(args[0]);
    let entry = this.store.get(key);
    if (entry && entry.expiresAt <= this.now) {
      this.store.delete(key);
      entry = undefined;
    }
    if (!entry) {
      entry = { count: 0, expiresAt: this.now + ttlMs };
      this.store.set(key, entry);
      this.pexpireCalls += 1;
    }
    entry.count += 1;
    const pttl = entry.expiresAt - this.now;
    return [entry.count, pttl];
  }
}

describe('UpstashRedisThrottlerStorage', () => {
  const LIMIT = 10;
  const TTL_MS = 60_000;

  function makeStorage(fake: FakeRedis): UpstashRedisThrottlerStorage {
    return new UpstashRedisThrottlerStorage(fake);
  }

  it('sends the atomic script, key, and window TTL to Redis', async () => {
    const fake = new FakeRedis();
    const storage = makeStorage(fake);

    await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');

    expect(fake.evalCalls).toHaveLength(1);
    expect(fake.evalCalls[0].script).toBe(FIXED_WINDOW_SCRIPT);
    expect(fake.evalCalls[0].keys).toEqual(['bucket-a']);
    expect(fake.evalCalls[0].args).toEqual([TTL_MS]);
  });

  it('initializes the window TTL only on the first hit of a window', async () => {
    const fake = new FakeRedis();
    const storage = makeStorage(fake);

    await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
    await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
    await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');

    // One PEXPIRE per window, never reset by later hits: the fixed window
    // cannot be extended.
    expect(fake.pexpireCalls).toBe(1);
  });

  it('allows exactly `limit` hits and blocks the (limit + 1)th', async () => {
    const fake = new FakeRedis();
    const storage = makeStorage(fake);

    for (let hit = 1; hit <= LIMIT; hit++) {
      const record = await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
      expect(record.totalHits).toBe(hit);
      expect(record.isBlocked).toBe(false);
    }

    const blocked = await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
    expect(blocked.totalHits).toBe(LIMIT + 1);
    expect(blocked.isBlocked).toBe(true);
  });

  it('keeps blocked retries blocked without extending the fixed window', async () => {
    const fake = new FakeRedis();
    const storage = makeStorage(fake);

    for (let hit = 1; hit <= LIMIT + 3; hit++) {
      const record = await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
      if (hit <= LIMIT) {
        expect(record.isBlocked).toBe(false);
      } else {
        expect(record.isBlocked).toBe(true);
      }
    }

    // Every hit after the first is served without a new PEXPIRE: blocked
    // retries never extend the window.
    expect(fake.pexpireCalls).toBe(1);
    const entry = fake.store.get('bucket-a');
    expect(entry?.expiresAt).toBe(TTL_MS);
  });

  it('converts PTTL milliseconds to seconds with ceil rounding', async () => {
    const fake = new FakeRedis();
    const storage = makeStorage(fake);

    const first = await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
    expect(first.timeToExpire).toBe(60); // 60000ms -> 60s

    fake.now = 1_501; // PTTL 58499ms -> ceil(58.499) = 59s
    const second = await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
    expect(second.timeToExpire).toBe(59);

    fake.now = TTL_MS - 2_501; // PTTL 2501ms -> 3s
    const third = await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
    expect(third.timeToExpire).toBe(3);

    fake.now = TTL_MS - 1; // PTTL 1ms -> 1s
    const fourth = await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
    expect(fourth.timeToExpire).toBe(1);
    // At now === expiresAt the key is gone and a fresh window starts
    // (covered by "starts a fresh window…"), which is why there is no
    // PTTL === 0 case here.
  });

  it('reports timeToBlockExpire equal to timeToExpire when blocked, 0 otherwise', async () => {
    const fake = new FakeRedis();
    const storage = makeStorage(fake);

    const allowed = await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
    expect(allowed.isBlocked).toBe(false);
    expect(allowed.timeToBlockExpire).toBe(0);

    for (let hit = 2; hit <= LIMIT; hit++) {
      await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
    }
    const blocked = await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.timeToBlockExpire).toBe(blocked.timeToExpire);
  });

  it('starts a fresh window after the fixed window expires', async () => {
    const fake = new FakeRedis();
    const storage = makeStorage(fake);

    await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
    await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');

    fake.now = TTL_MS + 1; // previous window fully expired

    const fresh = await storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');
    expect(fresh.totalHits).toBe(1);
    expect(fresh.isBlocked).toBe(false);
    expect(fake.pexpireCalls).toBe(2); // new window, new TTL initialization
  });

  it('fails closed with 503 when Redis errors, without any fallback', async () => {
    const fake = new FakeRedis();
    fake.failNext = true;
    const storage = makeStorage(fake);

    const attempt = storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login');

    await expect(attempt).rejects.toBeInstanceOf(RateLimiterUnavailableError);

    // Second outage: re-arm the fake so this call also fails. The error
    // keeps the public 503 contract with a static, secret-free message.
    fake.failNext = true;
    await expect(
      storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login'),
    ).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'RATE_LIMITER_UNAVAILABLE',
        message: 'The rate limiter is temporarily unavailable.',
      },
    });

    // The only counter is the Redis-backed one: nothing was recorded locally.
    expect(fake.store.get('bucket-a')).toBeUndefined();
    expect(fake.evalCalls).toHaveLength(2); // both attempts hit Redis, both failed
  });

  it('fails closed on malformed script results', async () => {
    const fake = new FakeRedis();
    const storage = makeStorage(fake);

    fake.malformedResult = null;
    await expect(
      storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login'),
    ).rejects.toBeInstanceOf(RateLimiterUnavailableError);

    fake.malformedResult = [];
    await expect(
      storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login'),
    ).rejects.toBeInstanceOf(RateLimiterUnavailableError);

    fake.malformedResult = ['not-a-number', 'also-not'];
    await expect(
      storage.increment('bucket-a', TTL_MS, LIMIT, TTL_MS, 'login'),
    ).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });
});
