import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp, getCorsOrigins } from '../src/configure-app.js';

describe('prefix and CORS (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('global prefix', () => {
    it('serves health under /api/v1', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.database.status).toBe('up');
    });

    it('returns 404 for the unprefixed health route', async () => {
      await request(app.getHttpServer()).get('/health').expect(404);
    });

    it('returns 404 for the removed scaffold root route', async () => {
      await request(app.getHttpServer()).get('/').expect(404);
    });

    it('returns the normalised error shape for unknown routes', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/does-not-exist')
        .expect(404);

      expect(res.body).toEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: expect.any(String),
        error: 'Not Found',
      });
    });
  });

  describe('CORS allowlist', () => {
    const preflight = (origin: string) =>
      request(app.getHttpServer())
        .options('/api/v1/health')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET');

    it('allows the Vite dev origin', async () => {
      const res = await preflight('http://localhost:5173').expect(204);

      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:5173',
      );
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('allows the loopback Vite dev origin', async () => {
      const res = await preflight('http://127.0.0.1:5173').expect(204);

      expect(res.headers['access-control-allow-origin']).toBe(
        'http://127.0.0.1:5173',
      );
    });

    it('rejects origins outside the allowlist', async () => {
      const res = await preflight('http://evil.example').expect(204);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('parses CORS_ORIGIN as an explicit allowlist', () => {
      const original = process.env['CORS_ORIGIN'];

      process.env['CORS_ORIGIN'] =
        'http://localhost:5173, http://127.0.0.1:5173';
      expect(getCorsOrigins()).toEqual([
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ]);

      process.env['CORS_ORIGIN'] = 'https://app.example.com';
      expect(getCorsOrigins()).toEqual(['https://app.example.com']);

      if (original === undefined) delete process.env['CORS_ORIGIN'];
      else process.env['CORS_ORIGIN'] = original;
    });
  });
});
