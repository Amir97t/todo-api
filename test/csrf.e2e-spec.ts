import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { CsrfGuard } from '../src/auth/csrf.guard.js';
import { CsrfService } from '../src/auth/csrf.service.js';
import { JwtStrategy } from '../src/auth/jwt.strategy.js';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { configureApp } from '../src/configure-app.js';
import cookieParser from 'cookie-parser';
import { vi } from 'vitest';

describe('CSRF enforcement (e2e)', () => {
  let app: INestApplication;

  const mockAuthService = {
    register: vi.fn().mockResolvedValue({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    }),
    login: vi.fn().mockResolvedValue({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    }),
    refresh: vi.fn().mockResolvedValue({
      accessToken: 'mock-new-access-token',
      refreshToken: 'mock-new-refresh-token',
    }),
    revokeTokenFamily: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // AuthController carries @UseGuards(AuthRateLimitGuard); Nest
        // instantiates guard classes as enhancers, so the throttler tokens
        // must resolve. Limits are irrelevant here — CSRF checks short-circuit
        // before any rate-limit-relevant traffic.
        ThrottlerModule.forRoot({ throttlers: [{ name: 'csrf-suite', limit: 1000, ttl: 60_000 }] }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.registerAsync({
          imports: [ConfigModule],
          useFactory: async (configService: ConfigService) => ({
            secret: configService.get<string>('JWT_SECRET'),
            signOptions: { expiresIn: '15m' },
          }),
          inject: [ConfigService],
        }),
        PrismaModule,
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        JwtStrategy,
        JwtAuthGuard,
        CsrfService,
        CsrfGuard,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const getCsrfToken = async (): Promise<{ token: string; cookie: string }> => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/csrf')
      .expect(200);

    const cookie = res.headers['set-cookie']?.[0] || '';
    const csrfCookie = cookie.split(';')[0].split('=')[1];

    return { token: res.body.csrfToken, cookie: csrfCookie };
  };

  describe('GET /api/v1/auth/csrf', () => {
    it('returns a CSRF token and sets the cookie', async () => {
      const { token, cookie } = await getCsrfToken();

      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(0);
      expect(cookie).toBeDefined();
      expect(cookie.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/auth/register', () => {
    it('rejects request with missing CSRF cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:5173')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('rejects request with missing CSRF header', async () => {
      const { cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `csrfToken=${cookie}`)
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('rejects request with mismatched CSRF cookie and header', async () => {
      const { cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', 'wrong-token')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('accepts request with valid matching CSRF cookie and header', async () => {
      const { token, cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .send({ email: 'csrf-test-register@example.com', password: 'password123' })
        .expect(201);

      expect(res.body.accessToken).toBe('mock-access-token');
      expect(mockAuthService.register).toHaveBeenCalledWith(
        'csrf-test-register@example.com',
        'password123'
      );
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('rejects request with missing CSRF cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:5173')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('rejects request with missing CSRF header', async () => {
      const { cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `csrfToken=${cookie}`)
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('rejects request with mismatched CSRF cookie and header', async () => {
      const { cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', 'wrong-token')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('accepts request with valid matching CSRF cookie and header', async () => {
      const { token, cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .send({ email: 'csrf-test-login@example.com', password: 'password123' })
        .expect(200);

      expect(res.body.accessToken).toBe('mock-access-token');
      expect(mockAuthService.login).toHaveBeenCalledWith(
        'csrf-test-login@example.com',
        'password123'
      );
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('rejects request with missing CSRF cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:5173')
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('rejects request with missing CSRF header', async () => {
      const { cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `csrfToken=${cookie}`)
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('rejects request with mismatched CSRF cookie and header', async () => {
      const { cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', 'wrong-token')
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('accepts request with valid matching CSRF cookie and header', async () => {
      const { token, cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `csrfToken=${cookie}; refreshToken=dummy-refresh-token`)
        .set('x-csrf-token', token)
        .expect(200);

      expect(res.body.accessToken).toBe('mock-new-access-token');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('rejects request with missing CSRF cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:5173')
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('rejects request with missing CSRF header', async () => {
      const { cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `csrfToken=${cookie}`)
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('rejects request with mismatched CSRF cookie and header', async () => {
      const { cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', 'wrong-token')
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('accepts request with valid matching CSRF cookie and header', async () => {
      const { token, cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .expect(200);

      expect(res.body.ok).toBe(true);
    });
  });

  describe('Origin validation', () => {
    it('rejects request from invalid origin', async () => {
      const { token, cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', 'http://evil.example')
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(403);

      expect(res.body.code).toBe('ORIGIN_INVALID');
    });

    it('rejects state-changing request with no Origin header', async () => {
      const { token, cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(403);

      expect(res.body.code).toBe('ORIGIN_INVALID');
    });

    it('rejects state-changing request with Origin null', async () => {
      const { token, cookie } = await getCsrfToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', 'null')
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(403);

      expect(res.body.code).toBe('ORIGIN_INVALID');
    });

    it('does not apply the Origin policy to safe methods', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/csrf')
        .expect(200);
    });
  });
});