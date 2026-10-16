import type { INestApplication } from '@nestjs/common';

const DEFAULT_CORS_ORIGIN = 'http://localhost:5173,http://127.0.0.1:5173';

export function getCorsOrigins(): string[] {
  return (process.env['CORS_ORIGIN'] || DEFAULT_CORS_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function configureApp(app: INestApplication): INestApplication {
  // Trust exactly one proxy hop (the Vercel edge in Production, the local
  // server locally). This makes Express `req.ip` apply its
  // rightmost-untrusted-hop parse of X-Forwarded-For — the spoof-resistant
  // way to obtain the client IP for rate-limit bucketing. Never parse
  // X-Forwarded-For by hand. `trust proxy` is an Express setting, so it is
  // set on the underlying Express instance via the HTTP adapter.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: getCorsOrigins(),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false,
  });

  return app;
}
