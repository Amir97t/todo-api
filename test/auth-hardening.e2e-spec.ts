import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { CsrfGuard } from '../src/auth/csrf.guard.js';
import { CsrfService } from '../src/auth/csrf.service.js';
import { AuthRateLimitGuard } from '../src/auth/throttler/auth-rate-limit.guard.js';
import { RateLimiterUnavailableError } from '../src/auth/throttler/rate-limiter.errors.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { GlobalExceptionFilter } from '../src/app/filters/global-exception.filter.js';
import { getClientIp } from '../src/common/get-client-ip.js';
import { ConfigModule } from '@nestjs/config';
import { configureApp } from '../src/configure-app.js';
import cookieParser from 'cookie-parser';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'HardeningPass!123';

const RATE_LIMIT_ENV_KEYS = [
  'RATE_LIMIT',
  'RATE_LIMIT_PROVIDER',
  'RATE_LIMIT_LOGIN',
  'RATE_LIMIT_REGISTER',
  'RATE_LIMIT_REFRESH',
] as const;

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function extractCookie(setCookie: string[] | string | undefined, name: string): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const cookie of list) {
    const [pair] = cookie.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.slice(0, eq) === name) {
      return decodeURIComponent(pair.slice(eq + 1));
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Remove only accounts created by this suite and their owned resources.
 * Lists restrict User deletion, so delete tasks and owned lists first;
 * refresh tokens are removed by the User -> RefreshToken cascade.
 */
async function cleanupCreatedUsers(prisma: PrismaService, emails: string[]): Promise<void> {
  if (emails.length === 0) return;

  await prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    if (userIds.length === 0) return;

    const lists = await tx.list.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    const listIds = lists.map((list) => list.id);

    if (listIds.length > 0) {
      await tx.task.deleteMany({ where: { listId: { in: listIds } } });
    }
    await tx.list.deleteMany({ where: { userId: { in: userIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

describe('Auth hardening (e2e)', () => {
  describe('rate limiting + refresh replay/race (real AuthModule, memory provider)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    const savedEnv = new Map<string, string | undefined>();
    const createdEmails: string[] = [];

    const getCsrf = async (): Promise<{ token: string; cookie: string }> => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/csrf').expect(200);
      return {
        token: res.body.csrfToken as string,
        cookie: extractCookie(res.headers['set-cookie'], 'csrfToken') ?? '',
      };
    };

    const postLogin = (ip: string, email: string) =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email, password: 'wrong-password' });

    const registerUser = async (ip: string, email: string): Promise<string> => {
      const { token, cookie } = await getCsrf();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .set('X-Forwarded-For', ip)
        .send({ email, password: PASSWORD })
        .expect(201);
      createdEmails.push(email);
      const refreshToken = extractCookie(res.headers['set-cookie'], 'refreshToken');
      expect(refreshToken).toBeTruthy();
      return refreshToken as string;
    };

    const postRefresh = (ip: string, refreshToken: string) =>
      (async () => {
        const { token, cookie } = await getCsrf();
        return request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Origin', ORIGIN)
          .set('Cookie', `csrfToken=${cookie}; refreshToken=${refreshToken}`)
          .set('x-csrf-token', token)
          .set('X-Forwarded-For', ip);
      })();

    beforeAll(async () => {
      for (const key of RATE_LIMIT_ENV_KEYS) {
        savedEnv.set(key, process.env[key]);
      }
      process.env.RATE_LIMIT = 'on';
      process.env.RATE_LIMIT_PROVIDER = 'memory';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, PrismaModule],
        // Mirror AppModule: the global filter renders the production error
        // shape ({ statusCode, code, message, error }) for 429/401/503.
        providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.use(cookieParser());
      configureApp(app);
      await app.init();
      prisma = app.get(PrismaService);
    });

    afterAll(async () => {
      try {
        // Prisma is still connected here. Do not swallow cleanup failures:
        // a failed cleanup must fail the suite instead of leaking test data.
        if (prisma) {
          await cleanupCreatedUsers(prisma, createdEmails);
        }
      } finally {
        // Always tear down and restore shared process state, even on failure.
        await app?.close();
        for (const [key, value] of savedEnv) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
    });

    describe('login fixed window (10/min default)', () => {
      it('allows exactly 10 login attempts and rejects the 11th with 429', async () => {
        const ip = '203.0.113.80';
        const email = uniqueEmail('limit-exact');

        for (let attempt = 1; attempt <= 10; attempt++) {
          // Rate limiting runs before CSRF, so attempts are counted even
          // though these requests fail the CSRF check afterwards.
          await postLogin(ip, email).expect(403);
        }

        const res = await postLogin(ip, email).expect(429);
        expect(res.body.code).toBe('RATE_LIMITED');
        expect(res.body.error).toBe('Too Many Requests');
      });

      it('limits a single client IP across different emails', async () => {
        const ip = '203.0.113.70';

        for (let attempt = 1; attempt <= 10; attempt++) {
          await postLogin(ip, uniqueEmail(`ip-bucket-${attempt}`)).expect(403);
        }

        // Fresh email bucket, same IP: the IP bucket is what trips.
        await postLogin(ip, uniqueEmail('ip-bucket-11')).expect(429);
      });

      it('limits a single email across different client IPs', async () => {
        const email = uniqueEmail('email-bucket');

        for (let attempt = 1; attempt <= 10; attempt++) {
          await postLogin(`198.51.100.${attempt}`, email).expect(403);
        }

        // Fresh IP bucket, same email: the HMAC-email bucket is what trips.
        await postLogin('198.51.100.200', email).expect(429);
      });

      it('ignores the spoofable x-real-ip header for bucket identity', async () => {
        const ip = '203.0.113.60';

        for (let attempt = 1; attempt <= 10; attempt++) {
          await request(app.getHttpServer())
            .post('/api/v1/auth/login')
            .set('X-Forwarded-For', ip)
            .set('x-real-ip', `192.0.2.${attempt}`)
            .send({ email: uniqueEmail(`xreal-${attempt}`), password: 'wrong' })
            .expect(403);
        }

        // If x-real-ip were (wrongly) used as the tracker, every request
        // would mint a fresh bucket and this 11th attempt would not be 429.
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', ip)
          .set('x-real-ip', '192.0.2.255')
          .send({ email: uniqueEmail('xreal-11'), password: 'wrong' })
          .expect(429);
      });
    });

    describe('auth flows under an enabled limiter', () => {
      it('completes a successful login with the limiter enabled', async () => {
        const ip = '203.0.113.90';
        const email = uniqueEmail('login-happy');
        await registerUser(ip, email);

        const { token, cookie } = await getCsrf();
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('Origin', ORIGIN)
          .set('Cookie', `csrfToken=${cookie}`)
          .set('x-csrf-token', token)
          .set('X-Forwarded-For', ip)
          .send({ email, password: PASSWORD })
          .expect(200);

        expect(res.body.accessToken).toEqual(expect.any(String));
      });

      it('cleans up a registered test user, owned Inbox, and refresh tokens', async () => {
        const email = uniqueEmail('cleanup-regression');
        await registerUser('203.0.113.93', email);

        const user = await prisma.user.findUnique({ where: { email } });
        expect(user).not.toBeNull();
        expect(await prisma.list.count({ where: { userId: user!.id } })).toBe(1);
        expect(await prisma.refreshToken.count({ where: { userId: user!.id } })).toBeGreaterThan(0);

        await cleanupCreatedUsers(prisma, [email]);

        expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
        expect(await prisma.list.count({ where: { userId: user!.id } })).toBe(0);
        expect(await prisma.refreshToken.count({ where: { userId: user!.id } })).toBe(0);
      });

      it('revokes the whole family when a refresh is replayed after rotation', async () => {
        const ip = '203.0.113.91';
        const original = await registerUser(ip, uniqueEmail('replay'));

        // First rotation succeeds and issues a successor token.
        const first = await postRefresh(ip, original);
        expect(first.status).toBe(200);
        const successor = extractCookie(first.headers['set-cookie'], 'refreshToken');
        expect(successor).toBeTruthy();

        // Replaying the already-consumed original is reuse: 401.
        const replay = await postRefresh(ip, original);
        expect(replay.status).toBe(401);
        expect(replay.body.code).toBe('UNAUTHORIZED');

        // The replay revoked the family, so the successor is unusable too.
        const successorAfterReplay = await postRefresh(ip, successor as string);
        expect(successorAfterReplay.status).toBe(401);
      });

      it('makes the descendant token unusable after a concurrent refresh race', async () => {
        const ip = '203.0.113.92';
        const original = await registerUser(ip, uniqueEmail('concurrent'));

        // Two concurrent refreshes with the same token: one wins the atomic
        // consume, the loser is treated as reuse and revokes the family.
        const [resA, resB] = await Promise.all([postRefresh(ip, original), postRefresh(ip, original)]);
        const statuses = [resA.status, resB.status].sort();
        expect(statuses).toEqual([200, 401]);

        const winner = resA.status === 200 ? resA : resB;
        const descendant = extractCookie(winner.headers['set-cookie'], 'refreshToken');
        expect(descendant).toBeTruthy();

        // After both requests finished, the winner's new token is revoked.
        const afterRace = await postRefresh(ip, descendant as string);
        expect(afterRace.status).toBe(401);
      });
    });
  });

  describe('Redis outage fails closed', () => {
    let app: INestApplication;

    const failingStorage: ThrottlerStorage = {
      increment: async () => {
        throw new RateLimiterUnavailableError();
      },
    };

    const mockAuthService = {
      register: async () => ({ accessToken: 'a', refreshToken: 'r' }),
      login: async () => ({ accessToken: 'a', refreshToken: 'r' }),
      refresh: async () => ({ accessToken: 'a', refreshToken: 'r' }),
      revokeTokenFamily: async () => undefined,
    };

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          ThrottlerModule.forRoot({
            throttlers: [{ name: 'login-ip', limit: 10, ttl: 60_000 }],
            getTracker: (req) => `ip:${getClientIp(req)}`,
            storage: failingStorage,
          }),
        ],
        controllers: [AuthController],
        providers: [
          { provide: AuthService, useValue: mockAuthService },
          CsrfService,
          CsrfGuard,
          AuthRateLimitGuard,
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

    it('returns 503 RATE_LIMITER_UNAVAILABLE instead of falling back', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'outage@example.com', password: 'whatever' })
        .expect(503);

      expect(res.body.code).toBe('RATE_LIMITER_UNAVAILABLE');
      expect(res.body.message).toBe('The rate limiter is temporarily unavailable.');
    });
  });

  describe('blocked retries do not extend the fixed window', () => {
    let app: INestApplication;

    const mockAuthService = {
      register: async () => ({ accessToken: 'a', refreshToken: 'r' }),
      login: async () => ({ accessToken: 'a', refreshToken: 'r' }),
      refresh: async () => ({ accessToken: 'a', refreshToken: 'r' }),
      revokeTokenFamily: async () => undefined,
    };

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          ThrottlerModule.forRoot({
            throttlers: [{ name: 'login-ip', limit: 2, ttl: 3_000 }],
            getTracker: (req) => `ip:${getClientIp(req)}`,
            storage: new ThrottlerStorageService(),
          }),
        ],
        controllers: [AuthController],
        providers: [
          { provide: AuthService, useValue: mockAuthService },
          CsrfService,
          CsrfGuard,
          AuthRateLimitGuard,
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

    it('keeps the original window expiry despite blocked retries', async () => {
      const ip = '203.0.113.50';
      const email = 'window-extension@example.com';
      const post = () =>
        request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email, password: 'wrong' });

      // Window opens at t≈0 with limit 2 (3s fixed window).
      await post().expect(403);
      await post().expect(403);
      await post().expect(429); // 3rd hit blocks

      await sleep(2_000); // t≈2s, still inside the original window
      // A blocked retry must NOT push the window out: if it did (sliding
      // window), the request after 3s below would still be blocked.
      await post().expect(429);

      await sleep(1_300); // t≈3.3s > original 3s expiry
      await post().expect(403); // fresh window: limiter passes again
    });
  });
});
