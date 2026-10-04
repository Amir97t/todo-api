import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { INBOX_LIST_ID } from '../src/common/inbox.constant.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIST_KEYS = ['createdAt', 'icon', 'id', 'name', 'updatedAt'];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('lists (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const trackedLists: string[] = [];
  const trackedTasks: string[] = [];

  const unique = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { id: { in: trackedTasks } } });
    await prisma.list.deleteMany({ where: { id: { in: trackedLists } } });

    const inbox = await prisma.list.findUnique({
      where: { id: INBOX_LIST_ID },
    });
    expect(inbox).not.toBeNull();

    await app.close();
  });

  async function createList(name: string, icon = 'folder') {
    const res = await api()
      .post('/api/v1/lists')
      .send({ name, icon })
      .expect(201);

    trackedLists.push(res.body.id);
    return res.body as {
      id: string;
      name: string;
      icon: string | null;
      createdAt: string;
      updatedAt: string;
    };
  }

  async function createTask(listId: string) {
    const task = await prisma.task.create({ data: { title: 'task', listId } });
    trackedTasks.push(task.id);
    return task;
  }

  describe('GET /api/v1/lists', () => {
    it('returns a bare array exposing only public fields', async () => {
      const res = await api().get('/api/v1/lists').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      for (const item of res.body) {
        expect(Object.keys(item).sort()).toEqual(LIST_KEYS);
      }
    });

    it('returns the Inbox with its real UUID, not the "inbox" alias', async () => {
      const res = await api().get('/api/v1/lists').expect(200);

      const ids = res.body.map((list: { id: string }) => list.id);
      expect(ids).toContain(INBOX_LIST_ID);
      expect(ids).not.toContain('inbox');
      expect(INBOX_LIST_ID).toMatch(UUID_RE);
    });

    it('puts the Inbox first', async () => {
      const res = await api().get('/api/v1/lists').expect(200);

      expect(res.body[0].id).toBe(INBOX_LIST_ID);
      expect(res.body[0].name).toBe('Inbox');
    });

    it('orders custom lists by creation time ascending', async () => {
      const first = await createList(unique('orderA'));
      await delay(25);
      const second = await createList(unique('orderB'));

      const res = await api().get('/api/v1/lists').expect(200);
      const ids: string[] = res.body.map((list: { id: string }) => list.id);

      const firstIndex = ids.indexOf(first.id);
      const secondIndex = ids.indexOf(second.id);

      expect(firstIndex).toBeGreaterThan(0);
      expect(secondIndex).toBeGreaterThan(firstIndex);
    });
  });

  describe('POST /api/v1/lists', () => {
    it('creates a list with a server-generated UUID', async () => {
      const name = unique('created');
      const res = await api()
        .post('/api/v1/lists')
        .send({ name, icon: 'briefcase' })
        .expect(201);

      trackedLists.push(res.body.id);

      expect(res.body.id).toMatch(UUID_RE);
      expect(res.body.name).toBe(name);
      expect(res.body.icon).toBe('briefcase');
      expect(Object.keys(res.body).sort()).toEqual(LIST_KEYS);
    });

    it('trims surrounding whitespace before storage', async () => {
      const res = await api()
        .post('/api/v1/lists')
        .send({ name: '   Padded Name   ', icon: 'folder' })
        .expect(201);

      trackedLists.push(res.body.id);
      expect(res.body.name).toBe('Padded Name');
    });

    it('accepts the system "inbox" icon value', async () => {
      const res = await api()
        .post('/api/v1/lists')
        .send({ name: unique('inboxicon'), icon: 'inbox' })
        .expect(201);

      trackedLists.push(res.body.id);
      expect(res.body.icon).toBe('inbox');
    });

    it('rejects a whitespace-only name with 400', async () => {
      const res = await api()
        .post('/api/v1/lists')
        .send({ name: '     ', icon: 'folder' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.body.message)).toBe(true);
    });

    it('rejects a case-insensitive duplicate with 409', async () => {
      const name = unique('DupName');
      await createList(name);

      const res = await api()
        .post('/api/v1/lists')
        .send({ name: name.toLowerCase(), icon: 'folder' })
        .expect(409);

      expect(res.body.code).toBe('LIST_NAME_EXISTS');
      expect(res.body.statusCode).toBe(409);
    });

    it('rejects a duplicate that differs only by surrounding whitespace with 409', async () => {
      const name = unique('SpacedDup');
      await createList(name);

      const res = await api()
        .post('/api/v1/lists')
        .send({ name: `   ${name.toLowerCase()}   `, icon: 'folder' })
        .expect(409);

      expect(res.body.code).toBe('LIST_NAME_EXISTS');
    });

    it('rejects an unknown icon with 400', async () => {
      const res = await api()
        .post('/api/v1/lists')
        .send({ name: unique('badicon'), icon: 'sparkles' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('icon');
    });

    it('rejects an unknown body field with 400', async () => {
      const res = await api()
        .post('/api/v1/lists')
        .send({ name: unique('extra'), icon: 'folder', colour: 'red' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('colour');
    });
  });

  describe('PATCH /api/v1/lists/:id', () => {
    it('renames a list', async () => {
      const list = await createList(unique('rename'));

      const res = await api()
        .patch(`/api/v1/lists/${list.id}`)
        .send({ name: 'Renamed List' })
        .expect(200);

      expect(res.body.name).toBe('Renamed List');
      expect(res.body.id).toBe(list.id);
      expect(Object.keys(res.body).sort()).toEqual(LIST_KEYS);
    });

    it('updates the icon', async () => {
      const list = await createList(unique('iconupdate'));

      const res = await api()
        .patch(`/api/v1/lists/${list.id}`)
        .send({ icon: 'plane' })
        .expect(200);

      expect(res.body.icon).toBe('plane');
      expect(res.body.name).toBe(list.name);
    });

    it('trims the supplied name', async () => {
      const list = await createList(unique('patchtrim'));

      const res = await api()
        .patch(`/api/v1/lists/${list.id}`)
        .send({ name: '   Trimmed Patch   ' })
        .expect(200);

      expect(res.body.name).toBe('Trimmed Patch');
    });

    it('rejects a name already used by another list with 409', async () => {
      const existing = await createList(unique('taken'));
      const target = await createList(unique('target'));

      const res = await api()
        .patch(`/api/v1/lists/${target.id}`)
        .send({ name: existing.name.toLowerCase() })
        .expect(409);

      expect(res.body.code).toBe('LIST_NAME_EXISTS');
    });

    it('allows renaming a list to its own normalised name', async () => {
      const list = await createList(unique('SelfName'));

      const res = await api()
        .patch(`/api/v1/lists/${list.id}`)
        .send({ name: `  ${list.name.toLowerCase()}  ` })
        .expect(200);

      expect(res.body.id).toBe(list.id);
      expect(res.body.name).toBe(list.name.toLowerCase());
    });

    it('returns 404 LIST_NOT_FOUND for a missing list', async () => {
      const res = await api()
        .patch(`/api/v1/lists/${randomUUID()}`)
        .send({ name: 'Ghost' })
        .expect(404);

      expect(res.body.code).toBe('LIST_NOT_FOUND');
    });

    it('returns 400 for an invalid UUID path parameter', async () => {
      const res = await api()
        .patch('/api/v1/lists/not-a-uuid')
        .send({ name: 'Nope' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('returns 403 INBOX_IMMUTABLE when renaming the Inbox', async () => {
      const res = await api()
        .patch(`/api/v1/lists/${INBOX_LIST_ID}`)
        .send({ name: 'Not Inbox' })
        .expect(403);

      expect(res.body.code).toBe('INBOX_IMMUTABLE');
      expect(res.body.statusCode).toBe(403);
    });

    it('returns 403 INBOX_IMMUTABLE when changing the Inbox icon', async () => {
      const res = await api()
        .patch(`/api/v1/lists/${INBOX_LIST_ID}`)
        .send({ icon: 'folder' })
        .expect(403);

      expect(res.body.code).toBe('INBOX_IMMUTABLE');

      const inbox = await prisma.list.findUnique({
        where: { id: INBOX_LIST_ID },
      });
      expect(inbox?.icon).toBe('inbox');
      expect(inbox?.name).toBe('Inbox');
    });

    it('rejects an unknown body field with 400', async () => {
      const list = await createList(unique('patchextra'));

      const res = await api()
        .patch(`/api/v1/lists/${list.id}`)
        .send({ colour: 'blue' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('colour');
    });
  });

  describe('DELETE /api/v1/lists/:id', () => {
    it('defaults to the relocate strategy', async () => {
      const list = await createList(unique('default'));
      const task = await createTask(list.id);

      const res = await api().delete(`/api/v1/lists/${list.id}`).expect(200);

      expect(res.body).toEqual({
        id: list.id,
        strategy: 'relocate',
        tasksAffected: 1,
      });

      const moved = await prisma.task.findUnique({
        where: { id: task.id },
      });
      expect(moved).not.toBeNull();
      expect(moved?.listId).toBe(INBOX_LIST_ID);
    });

    it('relocates every task to the Inbox and reports the count', async () => {
      const list = await createList(unique('relocate'));
      const tasks = [
        await createTask(list.id),
        await createTask(list.id),
        await createTask(list.id),
      ];

      const res = await api()
        .delete(`/api/v1/lists/${list.id}?strategy=relocate`)
        .expect(200);

      expect(res.body.strategy).toBe('relocate');
      expect(res.body.tasksAffected).toBe(3);

      const moved = await prisma.task.findMany({
        where: { id: { in: tasks.map((task) => task.id) } },
      });
      expect(moved).toHaveLength(3);
      expect(moved.every((task) => task.listId === INBOX_LIST_ID)).toBe(true);
      expect(
        await prisma.list.findUnique({ where: { id: list.id } }),
      ).toBeNull();
    });

    it('preserves task content when relocating', async () => {
      const list = await createList(unique('preserve'));
      const task = await createTask(list.id);
      await prisma.task.update({
        where: { id: task.id },
        data: { title: 'keep me', completed: true },
      });

      await api()
        .delete(`/api/v1/lists/${list.id}?strategy=relocate`)
        .expect(200);

      const preserved = await prisma.task.findUnique({
        where: { id: task.id },
      });
      expect(preserved?.title).toBe('keep me');
      expect(preserved?.completed).toBe(true);
    });

    it('deletes tasks when strategy=delete', async () => {
      const list = await createList(unique('deltasks'));
      const task = await createTask(list.id);

      const res = await api()
        .delete(`/api/v1/lists/${list.id}?strategy=delete`)
        .expect(200);

      expect(res.body).toEqual({
        id: list.id,
        strategy: 'delete',
        tasksAffected: 1,
      });
      expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
      expect(
        await prisma.list.findUnique({ where: { id: list.id } }),
      ).toBeNull();
    });

    it('removes checklist items through cascade when strategy=delete', async () => {
      const list = await createList(unique('cascade'));
      const task = await createTask(list.id);
      const item = await prisma.checklistItem.create({
        data: { text: 'step', position: 0, taskId: task.id },
      });

      const res = await api()
        .delete(`/api/v1/lists/${list.id}?strategy=delete`)
        .expect(200);

      expect(res.body.tasksAffected).toBe(1);
      expect(
        await prisma.checklistItem.findUnique({ where: { id: item.id } }),
      ).toBeNull();
    });

    it('leaves no orphaned tasks after either strategy', async () => {
      const relocating = await createList(unique('orphanA'));
      const deleting = await createList(unique('orphanB'));
      await createTask(relocating.id);
      await createTask(deleting.id);

      await api()
        .delete(`/api/v1/lists/${relocating.id}?strategy=relocate`)
        .expect(200);
      await api()
        .delete(`/api/v1/lists/${deleting.id}?strategy=delete`)
        .expect(200);

      const orphans = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "Task" t
         LEFT JOIN "List" l ON l.id = t."listId"
         WHERE l.id IS NULL`,
      );
      expect(orphans[0].n).toBe(0);

      const listIds = await prisma.list.findMany({ select: { id: true } });
      expect(listIds.map((row) => row.id)).not.toContain(relocating.id);
      expect(listIds.map((row) => row.id)).not.toContain(deleting.id);
    });

    it('returns 404 LIST_NOT_FOUND for a missing list', async () => {
      const res = await api()
        .delete(`/api/v1/lists/${randomUUID()}?strategy=relocate`)
        .expect(404);

      expect(res.body.code).toBe('LIST_NOT_FOUND');
    });

    it('returns 400 for an invalid UUID path parameter', async () => {
      const res = await api()
        .delete('/api/v1/lists/nope')
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('returns 400 for an invalid strategy', async () => {
      const list = await createList(unique('badstrategy'));

      const res = await api()
        .delete(`/api/v1/lists/${list.id}?strategy=explode`)
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('strategy');
      expect(
        await prisma.list.findUnique({ where: { id: list.id } }),
      ).not.toBeNull();
    });

    it('returns 403 INBOX_IMMUTABLE when deleting the Inbox', async () => {
      const res = await api()
        .delete(`/api/v1/lists/${INBOX_LIST_ID}?strategy=delete`)
        .expect(403);

      expect(res.body.code).toBe('INBOX_IMMUTABLE');
      expect(
        await prisma.list.findUnique({ where: { id: INBOX_LIST_ID } }),
      ).not.toBeNull();
    });

    it('returns 403 for the default strategy on the Inbox too', async () => {
      const res = await api()
        .delete(`/api/v1/lists/${INBOX_LIST_ID}`)
        .expect(403);

      expect(res.body.code).toBe('INBOX_IMMUTABLE');
    });
  });
});
