import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { sign } from 'jsonwebtoken';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { INBOX_LIST_ID } from '../src/common/inbox.constant.js';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'OwnershipPass!123';

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

describe('resource ownership (e2e)', () => {
  let prisma: PrismaService;
  const createdUserIds: string[] = [];

  const api = (app: INestApplication) => request(app.getHttpServer());

  async function registerUser(
    app: INestApplication,
    prefix: string,
  ): Promise<{ id: string; email: string; accessToken: string }> {
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

    return {
      id: user.id,
      email,
      accessToken: res.body.accessToken as string,
    };
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
    });

    afterAll(async () => {
      await cleanupCreatedUsers();
      process.env.REQUIRE_AUTH = savedRequireAuth;
      await app?.close();
    });

    // Unsafe resource mutations require the browser CSRF context in enforce
    // mode (allowed Origin + double-submit cookie/header) alongside the JWT.
    // The supertest value from api(app) is an agent, not a request, so the
    // headers are applied on the per-method Test it returns.
    async function unsafe(accessToken?: string) {
      const { token, cookie } = await csrfPair(app);
      return (
        method: 'post' | 'patch' | 'delete',
        url: string,
      ) => {
        let req = api(app)
          [method](url)
          .set('Origin', ORIGIN)
          .set('Cookie', `csrfToken=${cookie}`)
          .set('x-csrf-token', token);
        if (accessToken) {
          req = req.set('Authorization', `Bearer ${accessToken}`);
        }
        return req;
      };
    }

    it('keeps the health endpoint open without a token', async () => {
      await api(app).get('/api/v1/health').expect(200);
    });

    it('rejects unauthenticated resource requests with 401', async () => {
      const res = await api(app).get('/api/v1/lists').expect(401);
      expect(res.body.statusCode).toBe(401);
    });

    it('rejects a malformed Bearer token with 401', async () => {
      await api(app)
        .get('/api/v1/lists')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });

    it('rejects an expired Bearer token with 401', async () => {
      const user = await registerUser(app, 'expired');
      const expired = sign({ sub: user.id }, process.env.JWT_SECRET!, {
        expiresIn: '-10s',
      });

      await api(app)
        .get('/api/v1/lists')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
    });

    it('rejects a token signed with a wrong secret with 401', async () => {
      const user = await registerUser(app, 'wrongsecret');
      const forged = sign({ sub: user.id }, 'not-the-server-secret');

      await api(app)
        .get('/api/v1/lists')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('creates a personal Inbox named "Inbox" for every registered user', async () => {
      const user = await registerUser(app, 'inbox');

      const inboxes = await prisma.list.findMany({
        where: { userId: user.id, isInbox: true },
      });
      expect(inboxes).toHaveLength(1);
      expect(inboxes[0].name).toBe('Inbox');
      expect(inboxes[0].icon).toBe('inbox');

      const legacy = await prisma.list.findUnique({
        where: { id: INBOX_LIST_ID },
      });
      expect(legacy?.userId).toBeNull();
      expect(legacy?.isInbox).toBe(true);
    });

    it('rejects a duplicate registration and never creates a second Inbox', async () => {
      const email = uniqueEmail('dupe');

      const { token, cookie } = await csrfPair(app);

      await api(app)
        .post('/api/v1/auth/register')
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .send({ email, password: PASSWORD })
        .expect(201);

      await api(app)
        .post('/api/v1/auth/register')
        .set('Origin', ORIGIN)
        .set('Cookie', `csrfToken=${cookie}`)
        .set('x-csrf-token', token)
        .send({ email, password: PASSWORD })
        .expect(401);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      createdUserIds.push(user!.id);

      const inboxes = await prisma.list.findMany({
        where: { userId: user!.id, isInbox: true },
      });
      expect(inboxes).toHaveLength(1);
    });

    it('creates at most one Inbox per user under concurrent registration of the same email', async () => {
      const email = uniqueEmail('race');

      const { token, cookie } = await csrfPair(app);

      const results = await Promise.all([
        api(app)
          .post('/api/v1/auth/register')
          .set('Origin', ORIGIN)
          .set('Cookie', `csrfToken=${cookie}`)
          .set('x-csrf-token', token)
          .send({ email, password: PASSWORD }),
        api(app)
          .post('/api/v1/auth/register')
          .set('Origin', ORIGIN)
          .set('Cookie', `csrfToken=${cookie}`)
          .set('x-csrf-token', token)
          .send({ email, password: PASSWORD }),
      ]);

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 401]);

      const users = await prisma.user.findMany({ where: { email } });
      expect(users).toHaveLength(1);
      createdUserIds.push(users[0].id);

      const inboxes = await prisma.list.findMany({
        where: { userId: users[0].id, isInbox: true },
      });
      expect(inboxes).toHaveLength(1);
    });

    it('allows different users to own lists with the same name', async () => {
      const alice = await registerUser(app, 'alice');
      const bob = await registerUser(app, 'bob');

      await (await unsafe(alice.accessToken))('post', '/api/v1/lists')
        .send({ name: 'Shared Name', icon: 'folder' })
        .expect(201);

      await (await unsafe(bob.accessToken))('post', '/api/v1/lists')
        .send({ name: 'shared name', icon: 'folder' })
        .expect(201);
    });

    it('rejects a duplicate list name within one user with 409', async () => {
      const alice = await registerUser(app, 'dupname');

      await (await unsafe(alice.accessToken))('post', '/api/v1/lists')
        .send({ name: 'OnlyMine', icon: 'folder' })
        .expect(201);

      await (await unsafe(alice.accessToken))('post', '/api/v1/lists')
        .send({ name: 'onlymine', icon: 'folder' })
        .expect(409);
    });

    it('scopes list reads and writes to the authenticated user', async () => {
      const alice = await registerUser(app, 'scope-lists');
      const bob = await registerUser(app, 'scope-lists');

      const created = await (await unsafe(alice.accessToken))('post', '/api/v1/lists')
        .send({ name: `AliceList-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      const bobLists = await api(app)
        .get('/api/v1/lists')
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(200);
      const bobIds: string[] = bobLists.body.map((list: { id: string }) => list.id);
      expect(bobIds).not.toContain(created.body.id);

      await (await unsafe(bob.accessToken))('patch', `/api/v1/lists/${created.body.id}`)
        .send({ name: 'Stolen' })
        .expect(404);

      await (await unsafe(bob.accessToken))('delete', `/api/v1/lists/${created.body.id}?strategy=relocate`)
        .expect(404);

      await (await unsafe(alice.accessToken))('patch', `/api/v1/lists/${created.body.id}`)
        .send({ name: 'Still Alice' })
        .expect(200);
    });

    it('scopes tasks through their parent lists and blocks cross-user task access', async () => {
      const alice = await registerUser(app, 'scope-tasks');
      const bob = await registerUser(app, 'scope-tasks');

      const aliceList = await (await unsafe(alice.accessToken))('post', '/api/v1/lists')
        .send({ name: `Tasks-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      const aliceTask = await (await unsafe(alice.accessToken))('post', '/api/v1/tasks')
        .send({ title: 'alice-only', listId: aliceList.body.id })
        .expect(201);

      const bobTasks = await api(app)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(200);
      const bobTaskIds: string[] = bobTasks.body.map((task: { id: string }) => task.id);
      expect(bobTaskIds).not.toContain(aliceTask.body.id);

      await (await unsafe(bob.accessToken))('patch', `/api/v1/tasks/${aliceTask.body.id}`)
        .send({ title: 'hijacked' })
        .expect(404);

      await (await unsafe(bob.accessToken))('delete', `/api/v1/tasks/${aliceTask.body.id}`)
        .expect(404);

      await api(app)
        .get(`/api/v1/tasks?listId=${aliceList.body.id}`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual([]);
        });
    });

    it('rejects creating a task in another user\'s list with 404', async () => {
      const alice = await registerUser(app, 'create-in');
      const bob = await registerUser(app, 'create-in');

      const aliceList = await (await unsafe(alice.accessToken))('post', '/api/v1/lists')
        .send({ name: `Create-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      await (await unsafe(bob.accessToken))('post', '/api/v1/tasks')
        .send({ title: 'nope', listId: aliceList.body.id })
        .expect(404);
    });

    it('rejects moving a task to another user\'s list with 404', async () => {
      const alice = await registerUser(app, 'move');
      const bob = await registerUser(app, 'move');

      const aliceList = await (await unsafe(alice.accessToken))('post', '/api/v1/lists')
        .send({ name: `MoveA-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      const bobList = await (await unsafe(bob.accessToken))('post', '/api/v1/lists')
        .send({ name: `MoveB-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      const bobTask = await (await unsafe(bob.accessToken))('post', '/api/v1/tasks')
        .send({ title: 'mover', listId: bobList.body.id })
        .expect(201);

      await (await unsafe(bob.accessToken))('patch', `/api/v1/tasks/${bobTask.body.id}`)
        .send({ listId: aliceList.body.id })
        .expect(404);

      await (await unsafe(alice.accessToken))('patch', `/api/v1/tasks/${bobTask.body.id}`)
        .send({ title: 'stolen' })
        .expect(404);
    });

    it('scopes checklist items through their parent tasks and lists', async () => {
      const alice = await registerUser(app, 'checklist');
      const bob = await registerUser(app, 'checklist');

      const aliceList = await (await unsafe(alice.accessToken))('post', '/api/v1/lists')
        .send({ name: `Cl-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      const aliceTask = await (await unsafe(alice.accessToken))('post', '/api/v1/tasks')
        .send({ title: 'with-checklist', listId: aliceList.body.id })
        .expect(201);

      const item = await (await unsafe(alice.accessToken))('post', `/api/v1/tasks/${aliceTask.body.id}/checklist`)
        .send({ text: 'secret step' })
        .expect(201);

      await (await unsafe(bob.accessToken))('post', `/api/v1/tasks/${aliceTask.body.id}/checklist`)
        .send({ text: 'intruder' })
        .expect(404);

      await (await unsafe(bob.accessToken))('patch', `/api/v1/tasks/${aliceTask.body.id}/checklist/${item.body.id}`)
        .send({ completed: true })
        .expect(404);

      await (await unsafe(bob.accessToken))('delete', `/api/v1/tasks/${aliceTask.body.id}/checklist/${item.body.id}`)
        .expect(404);

      await (await unsafe(alice.accessToken))('patch', `/api/v1/tasks/${aliceTask.body.id}/checklist/${item.body.id}`)
        .send({ completed: true })
        .expect(200);
    });

    it('protects each user\'s Inbox by isInbox, not only the fixed UUID', async () => {
      const alice = await registerUser(app, 'immut');

      const aliceInbox = await prisma.list.findFirstOrThrow({
        where: { userId: alice.id, isInbox: true },
      });

      await (await unsafe(alice.accessToken))('patch', `/api/v1/lists/${aliceInbox.id}`)
        .send({ name: 'Not Inbox' })
        .expect(403);

      await (await unsafe(alice.accessToken))('delete', `/api/v1/lists/${aliceInbox.id}?strategy=delete`)
        .expect(403);

      const untouched = await prisma.list.findUnique({
        where: { id: aliceInbox.id },
      });
      expect(untouched?.name).toBe('Inbox');
    });

    it('relocates deleted-list tasks into the deleting user\'s own Inbox', async () => {
      const alice = await registerUser(app, 'relocate');
      const bob = await registerUser(app, 'relocate');

      const list = await (await unsafe(alice.accessToken))('post', '/api/v1/lists')
        .send({ name: `Relo-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      const task = await (await unsafe(alice.accessToken))('post', '/api/v1/tasks')
        .send({ title: 'relocate me', listId: list.body.id })
        .expect(201);

      const bobList = await (await unsafe(bob.accessToken))('post', '/api/v1/lists')
        .send({ name: `BobRelo-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      await (await unsafe(bob.accessToken))('delete', `/api/v1/lists/${bobList.body.id}?strategy=relocate`)
        .expect(200);

      const aliceInbox = await prisma.list.findFirstOrThrow({
        where: { userId: alice.id, isInbox: true },
      });
      const bobInbox = await prisma.list.findFirstOrThrow({
        where: { userId: bob.id, isInbox: true },
      });

      await (await unsafe(alice.accessToken))('delete', `/api/v1/lists/${list.body.id}?strategy=relocate`)
        .expect(200);

      const moved = await prisma.task.findUniqueOrThrow({
        where: { id: task.body.id },
      });
      expect(moved.listId).toBe(aliceInbox.id);
      expect(moved.listId).not.toBe(bobInbox.id);
      expect(moved.listId).not.toBe(INBOX_LIST_ID);
    });

    it('preserves case-insensitive title sorting within the authenticated scope', async () => {
      const alice = await registerUser(app, 'sort');

      const list = await (await unsafe(alice.accessToken))('post', '/api/v1/lists')
        .send({ name: `Sort-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      for (const title of ['beta', 'Alpha', 'charlie']) {
        await (await unsafe(alice.accessToken))('post', '/api/v1/tasks')
          .send({ title, listId: list.body.id })
          .expect(201);
      }

      const az = await api(app)
        .get('/api/v1/tasks?sort=az')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);
      expect(az.body.map((task: { title: string }) => task.title)).toEqual([
        'Alpha',
        'beta',
        'charlie',
      ]);

      const za = await api(app)
        .get('/api/v1/tasks?sort=za')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);
      expect(za.body.map((task: { title: string }) => task.title)).toEqual([
        'charlie',
        'beta',
        'Alpha',
      ]);
    });

    it('puts the authenticated user\'s Inbox first in the list listing', async () => {
      const alice = await registerUser(app, 'first');

      await (await unsafe(alice.accessToken))('post', '/api/v1/lists')
        .send({ name: `First-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      const res = await api(app)
        .get('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);

      expect(res.body[0].name).toBe('Inbox');
      expect(res.body[0].isInbox).toBe(true);
      const inboxRow = await prisma.list.findFirstOrThrow({
        where: { userId: alice.id, isInbox: true },
      });
      expect(res.body[0].id).toBe(inboxRow.id);
      expect(res.body[0].id).not.toBe(INBOX_LIST_ID);
      expect(
        res.body
          .slice(1)
          .every((list: { isInbox: boolean }) => list.isInbox === false),
      ).toBe(true);
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

    it('serves anonymous requests from the legacy rows only', async () => {
      const alice = await registerUser(app, 'anon');
      const userList = await api(app)
        .post('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ name: `User-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      const res = await api(app).get('/api/v1/lists').expect(200);
      const ids: string[] = res.body.map((list: { id: string }) => list.id);
      expect(ids).toContain(INBOX_LIST_ID);
      expect(ids).not.toContain(userList.body.id);

      expect(res.body[0].id).toBe(INBOX_LIST_ID);

      for (const list of res.body as Array<{ id: string }>) {
        const row = await prisma.list.findUnique({ where: { id: list.id } });
        expect(row?.userId).toBeNull();
      }
    });

    it('creates legacy (userId NULL) lists for anonymous mutations', async () => {
      const name = `Legacy-${randomUUID().slice(0, 8)}`;
      const res = await api(app)
        .post('/api/v1/lists')
        .send({ name, icon: 'folder' })
        .expect(201);

      const row = await prisma.list.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row.userId).toBeNull();
      expect(row.isInbox).toBe(false);

      await api(app).delete(`/api/v1/lists/${row.id}?strategy=delete`).expect(200);
    });

    it('still returns 401 for an invalid Bearer token instead of downgrading', async () => {
      const forged = sign({ sub: randomUUID() }, 'not-the-server-secret');

      await api(app)
        .get('/api/v1/lists')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);

      const expired = sign({ sub: randomUUID() }, process.env.JWT_SECRET!, {
        expiresIn: '-10s',
      });
      await api(app)
        .get('/api/v1/lists')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);

      await api(app)
        .get('/api/v1/lists')
        .set('Authorization', 'Bearer garbage')
        .expect(401);
    });

    it('scopes an authenticated request to its user even in off mode', async () => {
      const alice = await registerUser(app, 'off-auth');
      const created = await api(app)
        .post('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ name: `Off-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      const authed = await api(app)
        .get('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);
      const authedIds: string[] = authed.body.map((list: { id: string }) => list.id);
      expect(authedIds).toContain(created.body.id);
      expect(authedIds).not.toContain(INBOX_LIST_ID);

      const anonymous = await api(app).get('/api/v1/lists').expect(200);
      const anonIds: string[] = anonymous.body.map((list: { id: string }) => list.id);
      expect(anonIds).not.toContain(created.body.id);
    });

    it('relocates anonymous deletions into the legacy Inbox', async () => {
      const name = `LegacyRelo-${randomUUID().slice(0, 8)}`;
      const list = await api(app)
        .post('/api/v1/lists')
        .send({ name, icon: 'folder' })
        .expect(201);

      const task = await api(app)
        .post('/api/v1/tasks')
        .send({ title: 'legacy task', listId: list.body.id })
        .expect(201);

      await api(app)
        .delete(`/api/v1/lists/${list.body.id}?strategy=relocate`)
        .expect(200);

      const moved = await prisma.task.findUniqueOrThrow({
        where: { id: task.body.id },
      });
      expect(moved.listId).toBe(INBOX_LIST_ID);

      await api(app).delete(`/api/v1/tasks/${task.body.id}`).expect(200);
    });

    it('rejects anonymous access to another scope\'s resources with 404', async () => {
      const alice = await registerUser(app, 'cross');
      const userList = await api(app)
        .post('/api/v1/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ name: `Cross-${randomUUID().slice(0, 8)}`, icon: 'folder' })
        .expect(201);

      const userTask = await api(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ title: 'cross', listId: userList.body.id })
        .expect(201);

      await api(app)
        .patch(`/api/v1/lists/${userList.body.id}`)
        .send({ name: 'nope' })
        .expect(404);

      await api(app)
        .delete(`/api/v1/lists/${userList.body.id}?strategy=delete`)
        .expect(404);

      await api(app)
        .patch(`/api/v1/tasks/${userTask.body.id}`)
        .send({ title: 'nope' })
        .expect(404);

      await api(app)
        .delete(`/api/v1/tasks/${userTask.body.id}`)
        .expect(404);

      await api(app)
        .post(`/api/v1/tasks/${userTask.body.id}/checklist`)
        .send({ text: 'nope' })
        .expect(404);
    });

    it('creates a personal Inbox at registration even in off mode', async () => {
      const user = await registerUser(app, 'off-inbox');

      const inboxes = await prisma.list.findMany({
        where: { userId: user.id, isInbox: true },
      });
      expect(inboxes).toHaveLength(1);
      expect(inboxes[0].name).toBe('Inbox');
    });
  });
});
