import { createHmac } from 'crypto';

export interface AuthRateLimitRouteSettings {
  limit: number;
  ttlMs: number;
}

export interface AuthRateLimitSettings {
  enabled: boolean;
  provider: 'memory' | 'redis';
  login: AuthRateLimitRouteSettings;
  register: AuthRateLimitRouteSettings;
  refresh: AuthRateLimitRouteSettings;
  hmacSecret: string;
  upstashUrl: string;
  upstashToken: string;
}

/**
 * Raised when rate-limit configuration is missing or malformed. The message
 * always names only the offending environment VARIABLE, never its value.
 */
export class AuthRateLimitConfigError extends Error {
  constructor(public readonly variable: string) {
    super(`Invalid or missing required configuration: ${variable}`);
    this.name = 'AuthRateLimitConfigError';
  }
}

const RATE_PATTERN = /^(\d+)\/(\d+)(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours)$/i;

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
};

const DEFAULT_LIMITS = {
  login: '10/60s',
  register: '5/3600s',
  refresh: '30/60s',
};

function parseRate(
  raw: string | undefined,
  fallback: string,
  variable: string,
): AuthRateLimitRouteSettings {
  const value = (raw ?? fallback).trim();
  const match = RATE_PATTERN.exec(value);
  if (!match) {
    throw new AuthRateLimitConfigError(variable);
  }
  const limit = Number(match[1]);
  const windowMs = Number(match[2]) * UNIT_MS[match[3].toLowerCase()];
  if (!Number.isInteger(limit) || limit < 1) {
    throw new AuthRateLimitConfigError(variable);
  }
  if (!Number.isFinite(windowMs) || windowMs < 1_000) {
    throw new AuthRateLimitConfigError(variable);
  }
  return { limit, ttlMs: windowMs };
}

/**
 * Read-once, fail-closed rate-limit settings.
 *
 * Called at bootstrap (main.ts validation and the ThrottlerModule factory),
 * never per request. Misconfiguration throws with the variable NAME only.
 * Defaults: RATE_LIMIT=off; when enabled, provider defaults to "redis" so a
 * forgotten RATE_LIMIT_PROVIDER cannot silently fall back to per-instance
 * memory in Production.
 */
export function parseAuthRateLimitSettings(
  env: Record<string, string | undefined>,
): AuthRateLimitSettings {
  const rawEnabled = (env['RATE_LIMIT'] ?? 'off').trim().toLowerCase();
  if (rawEnabled !== 'on' && rawEnabled !== 'off') {
    throw new AuthRateLimitConfigError('RATE_LIMIT');
  }
  const enabled = rawEnabled === 'on';

  const login = parseRate(env['RATE_LIMIT_LOGIN'], DEFAULT_LIMITS.login, 'RATE_LIMIT_LOGIN');
  const register = parseRate(
    env['RATE_LIMIT_REGISTER'],
    DEFAULT_LIMITS.register,
    'RATE_LIMIT_REGISTER',
  );
  const refresh = parseRate(
    env['RATE_LIMIT_REFRESH'],
    DEFAULT_LIMITS.refresh,
    'RATE_LIMIT_REFRESH',
  );

  if (!enabled) {
    return {
      enabled: false,
      provider: 'memory',
      login,
      register,
      refresh,
      hmacSecret: '',
      upstashUrl: '',
      upstashToken: '',
    };
  }

  const rawProvider = (env['RATE_LIMIT_PROVIDER'] ?? 'redis').trim().toLowerCase();
  if (rawProvider !== 'memory' && rawProvider !== 'redis') {
    throw new AuthRateLimitConfigError('RATE_LIMIT_PROVIDER');
  }
  const provider = rawProvider;

  const hmacSecret = (env['RATE_LIMIT_HMAC_SECRET'] ?? '').trim();
  if (!hmacSecret) {
    throw new AuthRateLimitConfigError('RATE_LIMIT_HMAC_SECRET');
  }

  let upstashUrl = '';
  let upstashToken = '';
  if (provider === 'redis') {
    upstashUrl = (env['UPSTASH_REDIS_REST_URL'] ?? '').trim();
    upstashToken = (env['UPSTASH_REDIS_REST_TOKEN'] ?? '').trim();
    if (!upstashUrl) {
      throw new AuthRateLimitConfigError('UPSTASH_REDIS_REST_URL');
    }
    if (!upstashToken) {
      throw new AuthRateLimitConfigError('UPSTASH_REDIS_REST_TOKEN');
    }
  }

  return {
    enabled,
    provider,
    login,
    register,
    refresh,
    hmacSecret,
    upstashUrl,
    upstashToken,
  };
}

/**
 * Rate-limit bucket key for a normalized email: HMAC-SHA256 with a
 * server-side secret. The raw email and the secret never leave this function;
 * callers only ever see the hex digest.
 */
export function emailBucketKey(hmacSecret: string, rawEmail: string): string {
  const normalized = rawEmail.trim().toLowerCase();
  return createHmac('sha256', hmacSecret).update(normalized).digest('hex');
}
