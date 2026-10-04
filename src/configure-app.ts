import type { INestApplication } from '@nestjs/common';

const DEFAULT_CORS_ORIGIN = 'http://localhost:5173,http://127.0.0.1:5173';

export function getCorsOrigins(): string[] {
  return (process.env['CORS_ORIGIN'] || DEFAULT_CORS_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: getCorsOrigins(),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false,
  });

  return app;
}
