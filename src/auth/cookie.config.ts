import type { CookieOptions } from 'express';

function isProduction(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  const cookieSecure = process.env.COOKIE_SECURE;

  if (cookieSecure !== undefined) {
    return cookieSecure === 'true';
  }

  return nodeEnv === 'production';
}

function getCookieBaseOptions(): Pick<CookieOptions, 'httpOnly' | 'sameSite' | 'path'> {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/api/v1/auth',
  };
}

function getCsrfCookieBaseOptions(): Pick<CookieOptions, 'httpOnly' | 'sameSite' | 'path'> {
  return {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
  };
}

export function getRefreshTokenCookieOptions(): CookieOptions {
  const secure = isProduction();

  return {
    ...getCookieBaseOptions(),
    secure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function getCsrfTokenCookieOptions(): CookieOptions {
  const secure = isProduction();

  return {
    ...getCsrfCookieBaseOptions(),
    secure,
  };
}

export function getRefreshTokenClearOptions(): CookieOptions {
  const secure = isProduction();

  return {
    ...getCookieBaseOptions(),
    secure,
  };
}

export function getCsrfTokenClearOptions(): CookieOptions {
  const secure = isProduction();

  return {
    ...getCsrfCookieBaseOptions(),
    secure,
  };
}

export { isProduction };