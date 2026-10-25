import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const ORIGIN = 'http://localhost:5173';
const EVIL_ORIGIN = 'http://evil.example';
const PASSWORD = 'ResCsrfPass!123';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
}

function extractCookie(
  setCookie: string[] | string | undefined,
  name: string,
): string | undefined {
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

async function csrfPair(
  app: INestApplication,
): Promise<{ token: string; cookie: string }> {
  const res = await request(app.getHttpServer()).get('/api/v1/auth/csrf').expect(200);
  return {
    token: res.body.csrfToken as string,
    cookie: extractCookie(res.headers['set-cookie'], 'csrfToken') ?? '',
  };
}

describe('resource CSRF (e2e)', () => {
  let prisma: PrismaService;
  const createdUserIds: string[] = [];

  const api = (app: INestApplication) => request(app.getHttpServer());

  async function registerUser(
    app: INestApplication,
    prefix: string,
  ): Promise<{ id: string; accessToken: string }> {
    const email = uniqueEmail(prefix);
    const { token, cookie } = await csrfPair(app);

    const res = await api(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .set('Cookie', `csrfToken=${cookie}`)
      .set('x-csrf-token', token)
      .send({ email, password: PASSWORD })
      .expect(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdUserIds.push(user.id);

    return { id: user.id, accessToken: res.body.accessToken as string };
  }

  async function cleanupCreatedUsers(): Promise<void> {
    if (createdUserIds.length === 0) return;
    const userIds = [...new Set(createdUserIds.splice(0))];
    await prisma.task.deleteMany({
      where: { list: { userId: { in: userIds } } },
    });
    await prisma.list.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  describe('REQUIRE_AUTH=enforce', () => {
    let app: INestApplication;
    let savedRequireAuth: string | undefined;
    let alice: { id: string; accessToken: string };
    let aliceListId: string;
    let aliceTaskId: string;

    beforeAll(async () => {
      savedRequireAuth = process.env.REQUIRE_AUTH;
      process.env.REQUIRE_AUTH = 'enforce';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.use(cookieParser());
      configureApp(app);
      await app.init();
      prisma = app.get(PrismaService);

      alice = await registerUser(app, 'alice');

      const { token, cookie } = await csrfPair(app);
      const list = await api(app)
        .post('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .send({ name: `Csrf-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);
      aliceListId = list.body.id;

      const pair = await csrfPair(app);
      const task = await api(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${pair.cookie}`)
        .set('x-csrf-token', pair.token)
        .send({ title: 'csrf task', listId: aliceListId })
        .expect(201);
      aliceTaskId = task.body.id;
    });

    afterAll(async () => {
      await cleanupCreatedUsers();
      process.env.REQUIRE_AUTH = savedRequireAuth;
      await app?.close();
    });

    it('rejects an unsafe resource request from a disallowed Origin with 403 ORIGIN_INVALID', async () => {
      const { token, cookie } = await csrfPair(app);

      const res = await api(app)
        .post('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Origin', EVIL_ORIGIN)
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .send({ name: 'evil', icon: 'folder' })
        .expect(403);

      expect(res.body.code).toBe('ORIGIN_INVALID');
      expect(res.body.statusCode).toBe(403);
    });

    it('rejects an unsafe resource request with a missing Origin with 403 ORIGIN_INVALID', async () => {
      const { token, cookie } = await csrfPair(app);

      const res = await api(app)
        .post('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .send({ name: 'noorigin', icon: 'folder' })
        .expect(403);

      expect(res.body.code).toBe('ORIGIN_INVALID');
    });

    it('rejects an unsafe resource request with a missing CSRF cookie with 403 CSRF_INVALID', async () => {
      const { token } = await csrfPair(app);

      const res = await api(app)
        .post('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Origin', ORIGIN)
        .set('x-csrf-token', token)
        .send({ name: 'nocookie', icon: 'folder' })
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
      expect(res.body.statusCode).toBe(403);
    });

    it('rejects an unsafe resource request with a missing CSRF header with 403 CSRF_INVALID', async () => {
      const { cookie } = await csrfPair(app);

      const res = await api(app)
        .post('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${cookie}`)
        .send({ name: 'noheader', icon: 'folder' })
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('rejects an unsafe resource request with a mismatched cookie/header pair with 403 CSRF_INVALID', async () => {
      const first = await csrfPair(app);
      const second = await csrfPair(app);

      const res = await api(app)
        .post('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${first.cookie}`)
        .set('x-csrf-token', second.token)
        .send({ name: 'mismatch', icon: 'folder' })
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('allows an authorized mutation with an allowed Origin and a matching CSRF pair', async () => {
      const { token, cookie } = await csrfPair(app);

      const created = await api(app)
        .post('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .send({ name: `Valid-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      const patchPair = await csrfPair(app);
      await api(app)
        .patch(`/api/v1/lists/${created.body.id}`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${patchPair.cookie}`)
        .set('x-csrf-token', patchPair.token)
        .send({ name: 'Valid Renamed' })
        .expect(200);

      const taskPair = await csrfPair(app);
      await api(app)
        .post(`/api/v1/tasks/${aliceTaskId}/checklist`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${taskPair.cookie}`)
        .set('x-csrf-token', taskPair.token)
        .send({ text: 'csrf step' })
        .expect(201);

      const deletePair = await csrfPair(app);
      await api(app)
        .delete(`/api/v1/lists/${created.body.id}?strategy=delete`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${deletePair.cookie}`)
        .set('x-csrf-token', deletePair.token)
        .expect(200);
    });

    it('does not let a valid CSRF pair bypass ownership: cross-user mutation still 404s', async () => {
      const bob = await registerUser(app, 'bob');

      const { token, cookie } = await csrfPair(app);
      const res = await api(app)
        .patch(`/api/v1/lists/${aliceListId}`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .send({ name: 'hijacked' })
        .expect(404);

      expect(res.body.code).toBe('LIST_NOT_FOUND');

      const deletePair = await csrfPair(app);
      await api(app)
        .delete(`/api/v1/lists/${aliceListId}?strategy=relocate`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${deletePair.cookie}`)
        .set('x-csrf-token', deletePair.token)
        .expect(404);

      const stillThere = await prisma.list.findUnique({
        where: { id: aliceListId },
      });
      expect(stillThere).not.toBeNull();
    });

    it('keeps safe GET requests unaffected by CSRF', async () => {
      await api(app)
        .get('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);

      await api(app)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);

      await api(app)
        .get(`/api/v1/tasks?listId=${aliceListId}`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);
    });

    it('runs the scope guard before CSRF: unauthenticated unsafe requests get 401, not 403', async () => {
      const res = await api(app)
        .post('/api/v1/lists')
        .send({ name: 'anon', icon: 'folder' })
        .expect(401);

      expect(res.body.statusCode).toBe(401);
      expect(res.body.code).not.toBe('CSRF_INVALID');
      expect(res.body.code).not.toBe('ORIGIN_INVALID');
    });
  });

  describe('REQUIRE_AUTH=off', () => {
    let app: INestApplication;
    let savedRequireAuth: string | undefined;

    beforeAll(async () => {
      savedRequireAuth = process.env.REQUIRE_AUTH;
      process.env.REQUIRE_AUTH = 'off';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.use(cookieParser());
      configureApp(app);
      await app.init();
      prisma = app.get(PrismaService);
    });

    afterAll(async () => {
      await cleanupCreatedUsers();
      process.env.REQUIRE_AUTH = savedRequireAuth;
      await app?.close();
    });

    it('keeps the anonymous legacy workflow CSRF-free on resource mutations', async () => {
      const name = `Legacy-${randomUUID().slice(0, 8)}`;
      const created = await api(app)
        .post('/api/v1/lists')
        .send({ name, icon: 'folder' })
        .expect(201);

      const task = await api(app)
        .post('/api/v1/tasks')
        .send({ title: 'legacy', listId: created.body.id })
        .expect(201);

      await api(app)
        .patch(`/api/v1/lists/${created.body.id}`)
        .send({ name: 'Legacy Renamed' })
        .expect(200);

      // The task is deleted first: strategy=delete on the parent list would
      // already have removed it via task.deleteMany.
      await api(app).delete(`/api/v1/tasks/${task.body.id}`).expect(200);

      await api(app)
        .delete(`/api/v1/lists/${created.body.id}?strategy=delete`)
        .expect(200);
    });

    it('keeps authenticated resource mutations CSRF-free in off mode too', async () => {
      const user = await registerUser(app, 'off-auth');

      const created = await api(app)
        .post('/api/v1/lists')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: `OffCsrf-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      await api(app)
        .patch(`/api/v1/lists/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Off Renamed' })
        .expect(200);

      await api(app)
        .delete(`/api/v1/lists/${created.body.id}?strategy=delete`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
    });

    it('leaves auth-route CSRF enforcement unchanged regardless of REQUIRE_AUTH', async () => {
      // Allowed Origin but no cookie/header pair: the auth routes still run
      // the same double-submit check in off mode.
      const res = await api(app)
        .post('/api/v1/auth/register')
        .set('Origin', ORIGIN)
        .send({ email: uniqueEmail('nocsrf'), password: PASSWORD })
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
      expect(res.body.statusCode).toBe(403);
    });
  });
});
