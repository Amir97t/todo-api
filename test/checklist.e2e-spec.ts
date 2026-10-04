import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { INBOX_LIST_ID } from '../src/common/inbox.constant.js';

const ITEM_KEYS = ['completed', 'id', 'position', 'text'];

const unique = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

describe('checklist (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const trackedLists: string[] = [];

  const api = () => request(app.getHttpServer());
  const base = (taskId: string) => `/api/v1/tasks/${taskId}/checklist`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.checklistItem.deleteMany({});
    await prisma.task.deleteMany({});
  });

  afterAll(async () => {
    await prisma.checklistItem.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.list.deleteMany({ where: { id: { in: trackedLists } } });

    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.checklistItem.count()).toBe(0);

    const orphans = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "Task" t
       LEFT JOIN "List" l ON l.id = t."listId"
       WHERE l.id IS NULL`,
    );
    expect(orphans[0].n).toBe(0);

    const duplicatePositions = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM (
         SELECT "taskId", position FROM "ChecklistItem"
         GROUP BY "taskId", position HAVING count(*) > 1
       ) d`,
    );
    expect(duplicatePositions[0].n).toBe(0);

    expect(
      await prisma.list.findUnique({ where: { id: INBOX_LIST_ID } }),
    ).not.toBeNull();

    await app.close();
  });

  async function createList(name = unique('list')) {
    const res = await api()
      .post('/api/v1/lists')
      .send({ name, icon: 'folder' })
      .expect(201);

    trackedLists.push(res.body.id);
    return res.body as { id: string };
  }

  async function createTask(listId: string, overrides: Record<string, unknown> = {}) {
    const res = await api()
      .post('/api/v1/tasks')
      .send({ title: unique('task'), listId, ...overrides })
      .expect(201);

    return res.body as { id: string; checklist: Record<string, unknown>[] };
  }

  function addItem(taskId: string, body: Record<string, unknown>) {
    return api().post(base(taskId)).send(body);
  }

  function expectItemShape(item: Record<string, unknown>) {
    expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
    expect(typeof item['id']).toBe('string');
    expect(typeof item['text']).toBe('string');
    expect(typeof item['completed']).toBe('boolean');
    expect(typeof item['position']).toBe('number');
  }

  describe('POST checklist item', () => {
    it('creates the first item at position 0', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const res = await addItem(task.id, { text: 'Create migration' }).expect(201);

      expect(res.body.text).toBe('Create migration');
      expect(res.body.position).toBe(0);
      expect(res.body.completed).toBe(false);
      expectItemShape(res.body);
    });

    it('appends the second item at position 1', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      await addItem(task.id, { text: 'first' }).expect(201);
      const second = await addItem(task.id, { text: 'second' }).expect(201);
      const third = await addItem(task.id, { text: 'third' }).expect(201);

      expect(second.body.position).toBe(1);
      expect(third.body.position).toBe(2);

      const rows = await prisma.checklistItem.findMany({
        where: { taskId: task.id },
        orderBy: { position: 'asc' },
      });
      expect(rows.map((r) => r.text)).toEqual(['first', 'second', 'third']);
      expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    });

    it('trims the text', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const res = await addItem(task.id, { text: '   padded   ' }).expect(201);

      expect(res.body.text).toBe('padded');
    });

    it('returns 400 for whitespace-only text', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const res = await addItem(task.id, { text: '    ' }).expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('text');
    });

    it('returns 400 for an unknown body field', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const res = await addItem(task.id, { text: 'ok', colour: 'red' }).expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('colour');
    });

    it('rejects a client-supplied completed field', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const res = await addItem(task.id, { text: 'ok', completed: true }).expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('completed');
    });

    it('rejects a client-supplied position field', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const res = await addItem(task.id, { text: 'ok', position: 99 }).expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('position');
    });

    it('rejects a client-supplied id field', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const res = await addItem(task.id, {
        text: 'ok',
        id: randomUUID(),
      }).expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('id');
    });

    it('generates the id on the server', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const res = await addItem(task.id, { text: 'server id' }).expect(201);

      expect(res.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(
        await prisma.checklistItem.findUnique({ where: { id: res.body.id } }),
      ).not.toBeNull();
    });

    it('returns 404 TASK_NOT_FOUND for a missing task', async () => {
      const res = await addItem(randomUUID(), { text: 'x' }).expect(404);

      expect(res.body.code).toBe('TASK_NOT_FOUND');
    });

    it('returns 400 for an invalid task UUID', async () => {
      const res = await addItem('nope', { text: 'x' }).expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('never renumbers existing positions when appending', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const first = await addItem(task.id, { text: 'a' }).expect(201);
      const second = await addItem(task.id, { text: 'b' }).expect(201);
      const third = await addItem(task.id, { text: 'c' }).expect(201);

      expect([
        first.body.position,
        second.body.position,
        third.body.position,
      ]).toEqual([0, 1, 2]);
    });
  });

  describe('PATCH checklist item', () => {
    it('edits the text', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const item = await addItem(task.id, { text: 'before' }).expect(201);

      const res = await api()
        .patch(`${base(task.id)}/${item.body.id}`)
        .send({ text: 'after' })
        .expect(200);

      expect(res.body.text).toBe('after');
      expect(res.body.id).toBe(item.body.id);
      expect(res.body.position).toBe(0);
      expectItemShape(res.body);
    });

    it('trims the text', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const item = await addItem(task.id, { text: 'before' }).expect(201);

      const res = await api()
        .patch(`${base(task.id)}/${item.body.id}`)
        .send({ text: '   spaced   ' })
        .expect(200);

      expect(res.body.text).toBe('spaced');
    });

    it('returns 400 for whitespace-only text', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const item = await addItem(task.id, { text: 'before' }).expect(201);

      const res = await api()
        .patch(`${base(task.id)}/${item.body.id}`)
        .send({ text: '   ' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('sets completed to true', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const item = await addItem(task.id, { text: 'x' }).expect(201);

      const res = await api()
        .patch(`${base(task.id)}/${item.body.id}`)
        .send({ completed: true })
        .expect(200);

      expect(res.body.completed).toBe(true);
      expect(res.body.text).toBe('x');
    });

    it('sets completed back to false', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const item = await addItem(task.id, { text: 'x' }).expect(201);

      await api()
        .patch(`${base(task.id)}/${item.body.id}`)
        .send({ completed: true })
        .expect(200);

      const res = await api()
        .patch(`${base(task.id)}/${item.body.id}`)
        .send({ completed: false })
        .expect(200);

      expect(res.body.completed).toBe(false);
    });

    it('is idempotent for an explicit completed value', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const item = await addItem(task.id, { text: 'x' }).expect(201);

      for (let i = 0; i < 3; i += 1) {
        const res = await api()
          .patch(`${base(task.id)}/${item.body.id}`)
          .send({ completed: true })
          .expect(200);
        expect(res.body.completed).toBe(true);
      }
    });

    it('preserves omitted fields', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const item = await addItem(task.id, { text: 'keep me' }).expect(201);

      const res = await api()
        .patch(`${base(task.id)}/${item.body.id}`)
        .send({ completed: true })
        .expect(200);

      expect(res.body.completed).toBe(true);
      expect(res.body.text).toBe('keep me');
      expect(res.body.position).toBe(item.body.position);
    });

    it('returns 400 for an invalid task UUID', async () => {
      const res = await api()
        .patch(`/api/v1/tasks/nope/checklist/${randomUUID()}`)
        .send({ text: 'x' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('returns 400 for an invalid item UUID', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const res = await api()
        .patch(`${base(task.id)}/nope`)
        .send({ text: 'x' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('returns 404 TASK_NOT_FOUND for a missing task', async () => {
      const res = await api()
        .patch(`${base(randomUUID())}/${randomUUID()}`)
        .send({ text: 'x' })
        .expect(404);

      expect(res.body.code).toBe('TASK_NOT_FOUND');
    });

    it('returns 404 CHECKLIST_ITEM_NOT_FOUND for a missing item', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const res = await api()
        .patch(`${base(task.id)}/${randomUUID()}`)
        .send({ text: 'x' })
        .expect(404);

      expect(res.body.code).toBe('CHECKLIST_ITEM_NOT_FOUND');
    });

    it("returns 404 when the item belongs to another task", async () => {
      const list = await createList();
      const taskA = await createTask(list.id);
      const taskB = await createTask(list.id);
      const foreign = await addItem(taskB.id, { text: 'belongs to B' }).expect(201);

      const res = await api()
        .patch(`${base(taskA.id)}/${foreign.body.id}`)
        .send({ text: 'hijacked' })
        .expect(404);

      expect(res.body.code).toBe('CHECKLIST_ITEM_NOT_FOUND');

      const untouched = await prisma.checklistItem.findUnique({
        where: { id: foreign.body.id },
      });
      expect(untouched?.text).toBe('belongs to B');
    });

    it('rejects a client-supplied position', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const item = await addItem(task.id, { text: 'x' }).expect(201);

      const res = await api()
        .patch(`${base(task.id)}/${item.body.id}`)
        .send({ position: 7 })
        .expect(400);

      expect(res.body.message.join(' ')).toContain('position');
    });

    it('rejects a client-supplied taskId', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const item = await addItem(task.id, { text: 'x' }).expect(201);

      const res = await api()
        .patch(`${base(task.id)}/${item.body.id}`)
        .send({ taskId: randomUUID() })
        .expect(400);

      expect(res.body.message.join(' ')).toContain('taskId');
    });

    it('rejects a client-supplied id', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const item = await addItem(task.id, { text: 'x' }).expect(201);

      const res = await api()
        .patch(`${base(task.id)}/${item.body.id}`)
        .send({ id: randomUUID() })
        .expect(400);

      expect(res.body.message.join(' ')).toContain('id');
    });

    it('rejects an unknown body field', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const item = await addItem(task.id, { text: 'x' }).expect(201);

      const res = await api()
        .patch(`${base(task.id)}/${item.body.id}`)
        .send({ colour: 'red' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('colour');
    });
  });

  describe('DELETE checklist item', () => {
    it('deletes one item and returns its id', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const item = await addItem(task.id, { text: 'doomed' }).expect(201);

      const res = await api()
        .delete(`${base(task.id)}/${item.body.id}`)
        .expect(200);

      expect(res.body).toEqual({ id: item.body.id });
      expect(Object.keys(res.body)).toEqual(['id']);

      expect(
        await prisma.checklistItem.findUnique({ where: { id: item.body.id } }),
      ).toBeNull();
    });

    it('does not renumber the remaining positions', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const a = await addItem(task.id, { text: 'a' }).expect(201);
      const b = await addItem(task.id, { text: 'b' }).expect(201);
      const c = await addItem(task.id, { text: 'c' }).expect(201);

      await api().delete(`${base(task.id)}/${b.body.id}`).expect(200);

      const rows = await prisma.checklistItem.findMany({
        where: { taskId: task.id },
        orderBy: { position: 'asc' },
      });

      expect(rows.map((r) => r.text)).toEqual(['a', 'c']);
      expect(rows.map((r) => r.position)).toEqual([0, 2]);
      expect(rows.find((r) => r.id === a.body.id)?.position).toBe(0);
      expect(rows.find((r) => r.id === c.body.id)?.position).toBe(2);
    });

    it('returns 404 TASK_NOT_FOUND for a missing task', async () => {
      const res = await api()
        .delete(`${base(randomUUID())}/${randomUUID()}`)
        .expect(404);

      expect(res.body.code).toBe('TASK_NOT_FOUND');
    });

    it('returns 404 CHECKLIST_ITEM_NOT_FOUND for a missing item', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const res = await api()
        .delete(`${base(task.id)}/${randomUUID()}`)
        .expect(404);

      expect(res.body.code).toBe('CHECKLIST_ITEM_NOT_FOUND');
    });

    it('returns 400 for an invalid task UUID', async () => {
      const res = await api()
        .delete(`/api/v1/tasks/nope/checklist/${randomUUID()}`)
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('returns 400 for an invalid item UUID', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const res = await api().delete(`${base(task.id)}/nope`).expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('refuses to delete an item belonging to another task', async () => {
      const list = await createList();
      const taskA = await createTask(list.id);
      const taskB = await createTask(list.id);
      const foreign = await addItem(taskB.id, { text: 'safe' }).expect(201);

      const res = await api()
        .delete(`${base(taskA.id)}/${foreign.body.id}`)
        .expect(404);

      expect(res.body.code).toBe('CHECKLIST_ITEM_NOT_FOUND');
      expect(
        await prisma.checklistItem.findUnique({ where: { id: foreign.body.id } }),
      ).not.toBeNull();
    });
  });

  describe('concurrency', () => {
    it('serialises concurrent appends so positions stay unique', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const [first, second] = await Promise.all([
        addItem(task.id, { text: 'concurrent-a' }),
        addItem(task.id, { text: 'concurrent-b' }),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);

      const positions = [first.body.position, second.body.position].sort((a, b) => a - b);
      expect(positions).toEqual([0, 1]);

      const rows = await prisma.checklistItem.findMany({
        where: { taskId: task.id },
        orderBy: { position: 'asc' },
      });

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.position)).toEqual([0, 1]);
      expect(new Set(rows.map((r) => r.text)).size).toBe(2);
    });

    it('holds up under a wider burst of concurrent appends', async () => {
      const list = await createList();
      const task = await createTask(list.id);

      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => addItem(task.id, { text: `burst-${i}` })),
      );

      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);

      const rows = await prisma.checklistItem.findMany({
        where: { taskId: task.id },
        orderBy: { position: 'asc' },
      });

      expect(rows).toHaveLength(6);
      expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(new Set(rows.map((r) => r.text)).size).toBe(6);
    });
  });

  describe('response shape consistency', () => {
    it('embeds the same item shape in GET, POST and PATCH task responses', async () => {
      const list = await createList();

      const created = await api()
        .post('/api/v1/tasks')
        .send({
          title: 'shape check',
          listId: list.id,
          checklist: [{ text: 'one' }, { text: 'two' }],
        })
        .expect(201);

      for (const item of created.body.checklist) {
        expectItemShape(item);
      }
      expect(
        created.body.checklist.map((c: { position: number }) => c.position),
      ).toEqual([0, 1]);

      const patched = await api()
        .patch(`/api/v1/tasks/${created.body.id}`)
        .send({ title: 'renamed' })
        .expect(200);

      for (const item of patched.body.checklist) {
        expectItemShape(item);
      }

      const fetched = await api()
        .get(`/api/v1/tasks?listId=${list.id}`)
        .expect(200);

      const same = fetched.body.find((t: { id: string }) => t.id === created.body.id);
      expect(same.checklist).toEqual(patched.body.checklist);
      expect(patched.body.checklist).toEqual(created.body.checklist);
    });

    it('matches the standalone item shape exactly', async () => {
      const list = await createList();
      const task = await createTask(list.id);
      const standalone = await addItem(task.id, { text: 'aligned' }).expect(201);

      expectItemShape(standalone.body);

      const embedded = await api()
        .get(`/api/v1/tasks?listId=${list.id}`)
        .expect(200);

      const taskWithItem = embedded.body.find((t: { id: string }) => t.id === task.id);
      expect(taskWithItem.checklist[0]).toEqual(standalone.body);
    });
  });
});
