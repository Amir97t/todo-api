import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { INBOX_LIST_ID } from '../src/common/inbox.constant.js';

const TASK_KEYS = [
  'checklist',
  'completed',
  'createdAt',
  'description',
  'id',
  'listId',
  'title',
  'updatedAt',
];

const CHECKLIST_KEYS = ['completed', 'id', 'position', 'text'];

const unique = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

describe('tasks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const trackedLists: string[] = [];

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // Start from a known-empty task table so the suite owns every row it
    // creates and the "no tasks" assertion is meaningful.
    await prisma.checklistItem.deleteMany({});
    await prisma.task.deleteMany({});
  });

  afterAll(async () => {
    await prisma.checklistItem.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.list.deleteMany({ where: { id: { in: trackedLists } } });

    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.checklistItem.count()).toBe(0);
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

  function postTask(body: Record<string, unknown>) {
    return api().post('/api/v1/tasks').send(body);
  }

  function expectTaskShape(body: Record<string, unknown>) {
    expect(Object.keys(body).sort()).toEqual(TASK_KEYS);
    expect(typeof body['description']).toBe('string');
    expect(Array.isArray(body['checklist'])).toBe(true);
    expect(String(body['id'])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(String(body['createdAt'])).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  }

  describe('GET /api/v1/tasks', () => {
    it('returns an empty array when there are no tasks', async () => {
      const res = await api().get('/api/v1/tasks').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toEqual([]);
    });

    it('returns tasks as a bare array of public fields', async () => {
      const list = await createList();
      const created = await postTask({
        title: 'Visible task',
        listId: list.id,
      }).expect(201);

      const res = await api().get('/api/v1/tasks').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expectTaskShape(res.body[0]);
      expect(res.body[0].id).toBe(created.body.id);
    });

    it('filters by listId', async () => {
      const target = await createList();
      const other = await createList();

      const mine = await postTask({ title: 'mine', listId: target.id }).expect(201);
      await postTask({ title: 'theirs', listId: other.id }).expect(201);

      const res = await api()
        .get(`/api/v1/tasks?listId=${target.id}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(mine.body.id);
    });

    it('filters completed=true', async () => {
      const list = await createList();
      const done = await postTask({
        title: 'done task',
        listId: list.id,
        completed: true,
      }).expect(201);
      await postTask({ title: 'open task', listId: list.id }).expect(201);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}&completed=true`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(done.body.id);
      expect(res.body[0].completed).toBe(true);
    });

    it('filters completed=false', async () => {
      const list = await createList();
      await postTask({
        title: 'done only',
        listId: list.id,
        completed: true,
      }).expect(201);
      const open = await postTask({ title: 'open only', listId: list.id }).expect(201);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}&completed=false`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(open.body.id);
      expect(res.body[0].completed).toBe(false);
    });

    it('returns both when completed is omitted', async () => {
      const list = await createList();
      await postTask({ title: 'a done', listId: list.id, completed: true }).expect(201);
      await postTask({ title: 'b open', listId: list.id }).expect(201);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body.map((t: { completed: boolean }) => t.completed).sort()).toEqual([
        false,
        true,
      ]);
    });

    it('matches q against the title', async () => {
      const list = await createList();
      const token = unique('titlematch');
      const hit = await postTask({ title: token, listId: list.id }).expect(201);
      await postTask({ title: 'unrelated', listId: list.id }).expect(201);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}&q=${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(hit.body.id);
    });

    it('matches q against the description', async () => {
      const list = await createList();
      const token = unique('descmatch');
      const hit = await postTask({
        title: 'no token here',
        description: `body ${token}`,
        listId: list.id,
      }).expect(201);
      await postTask({ title: 'unrelated', listId: list.id }).expect(201);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}&q=${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(hit.body.id);
    });

    it('matches q case-insensitively', async () => {
      const list = await createList();
      const token = unique('CaseToken');
      await postTask({ title: token, listId: list.id }).expect(201);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}&q=${token.toLowerCase()}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
    });

    it('trims q before searching', async () => {
      const list = await createList();
      const token = unique('trimq');
      await postTask({ title: token, listId: list.id }).expect(201);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}&q=${encodeURIComponent(`  ${token}  `)}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
    });

    it('treats a whitespace-only q as no search', async () => {
      const list = await createList();
      await postTask({ title: 'anything', listId: list.id }).expect(201);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}&q=${encodeURIComponent('   ')}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
    });

    it('does not match checklist text', async () => {
      const list = await createList();
      const token = unique('checkonly');
      await postTask({
        title: 'task without the token in its title',
        checklist: [{ text: token }],
        listId: list.id,
      }).expect(201);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}&q=${token}`)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });

    it('sorts newest first by default', async () => {
      const list = await createList();
      const [old, mid, recent] = await createSortFixtures(list.id);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}`)
        .expect(200);

      expect(res.body.map((t: { id: string }) => t.id)).toEqual([
        recent.id,
        mid.id,
        old.id,
      ]);
    });

    it('sorts oldest first', async () => {
      const list = await createList();
      const [old, mid, recent] = await createSortFixtures(list.id);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}&sort=oldest`)
        .expect(200);

      expect(res.body.map((t: { id: string }) => t.id)).toEqual([
        old.id,
        mid.id,
        recent.id,
      ]);
    });

    it('sorts az by title case-insensitively', async () => {
      const list = await createList();
      await createSortFixtures(list.id);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}&sort=az`)
        .expect(200);

      expect(res.body.map((t: { title: string }) => t.title)).toEqual([
        'alpha',
        'Bravo',
        'Charlie',
      ]);
    });

    it('sorts za by title case-insensitively', async () => {
      const list = await createList();
      await createSortFixtures(list.id);

      const res = await api()
        .get(`/api/v1/tasks?listId=${list.id}&sort=za`)
        .expect(200);

      expect(res.body.map((t: { title: string }) => t.title)).toEqual([
        'Charlie',
        'Bravo',
        'alpha',
      ]);
    });

    it('orders checklist items by position', async () => {
      const list = await createList();
      const created = await postTask({
        title: 'ordered checklist',
        listId: list.id,
        checklist: [{ text: 'zeta' }, { text: 'alpha' }, { text: 'mid' }],
      }).expect(201);

      expect(created.body.checklist.map((c: { text: string }) => c.text)).toEqual([
        'zeta',
        'alpha',
        'mid',
      ]);
      expect(created.body.checklist.map((c: { position: number }) => c.position)).toEqual([
        0, 1, 2,
      ]);

      const res = await api().get('/api/v1/tasks').expect(200);
      const found = res.body.find((t: { id: string }) => t.id === created.body.id);

      expect(found.checklist.map((c: { position: number }) => c.position)).toEqual([
        0, 1, 2,
      ]);
      expect(
        Object.keys(found.checklist[0]).sort(),
      ).toEqual(CHECKLIST_KEYS);
    });

    it('returns "" for a task whose description is null in the database', async () => {
      const list = await createList();
      const task = await prisma.task.create({
        data: { title: 'null description', description: null, listId: list.id },
      });

      const res = await api().get('/api/v1/tasks').expect(200);
      const found = res.body.find((t: { id: string }) => t.id === task.id);

      expect(found.description).toBe('');
    });

    it('returns 400 for an invalid listId', async () => {
      const res = await api()
        .get('/api/v1/tasks?listId=not-a-uuid')
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('returns 400 for an invalid completed value', async () => {
      const res = await api()
        .get('/api/v1/tasks?completed=maybe')
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('completed');
    });

    it('returns 400 for an invalid sort', async () => {
      const res = await api().get('/api/v1/tasks?sort=sideways').expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('sort');
    });

    it('returns 400 for an unknown query parameter', async () => {
      const res = await api().get('/api/v1/tasks?bogus=1').expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('bogus');
    });
  });

  describe('POST /api/v1/tasks', () => {
    it('creates a minimal valid task with default values', async () => {
      const list = await createList();

      const res = await postTask({ title: 'Ship API', listId: list.id }).expect(201);

      expectTaskShape(res.body);
      expect(res.body.title).toBe('Ship API');
      expect(res.body.description).toBe('');
      expect(res.body.completed).toBe(false);
      expect(res.body.checklist).toEqual([]);
      expect(res.body.listId).toBe(list.id);
    });

    it('trims the title', async () => {
      const list = await createList();

      const res = await postTask({
        title: '   Ship API   ',
        listId: list.id,
      }).expect(201);

      expect(res.body.title).toBe('Ship API');
    });

    it('trims the description', async () => {
      const list = await createList();

      const res = await postTask({
        title: 'trimmed description',
        description: '   phase 1   ',
        listId: list.id,
      }).expect(201);

      expect(res.body.description).toBe('phase 1');
    });

    it('returns 400 for a whitespace-only title', async () => {
      const list = await createList();

      const res = await postTask({ title: '     ', listId: list.id }).expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('title');
    });

    it('defaults completed to false', async () => {
      const list = await createList();

      const res = await postTask({ title: 'defaults', listId: list.id }).expect(201);

      expect(res.body.completed).toBe(false);
    });

    it('returns "" when description is omitted', async () => {
      const list = await createList();

      const res = await postTask({ title: 'no description', listId: list.id }).expect(201);

      expect(res.body.description).toBe('');
    });

    it('returns 404 LIST_NOT_FOUND when listId does not exist', async () => {
      const res = await postTask({
        title: 'orphan',
        listId: randomUUID(),
      }).expect(404);

      expect(res.body.code).toBe('LIST_NOT_FOUND');
    });

    it('returns 400 for a malformed listId', async () => {
      const res = await postTask({
        title: 'bad uuid',
        listId: 'inbox',
      }).expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('returns 400 for an unknown body field', async () => {
      const list = await createList();

      const res = await postTask({
        title: 'extra',
        listId: list.id,
        colour: 'red',
      }).expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('colour');
    });

    it('accepts an empty checklist', async () => {
      const list = await createList();

      const res = await postTask({
        title: 'empty checklist',
        listId: list.id,
        checklist: [],
      }).expect(201);

      expect(res.body.checklist).toEqual([]);
    });

    it('creates every checklist item in request order with 0-based positions', async () => {
      const list = await createList();

      const res = await postTask({
        title: 'with checklist',
        listId: list.id,
        checklist: [
          { text: 'Create schema' },
          { text: 'Implement endpoints' },
          { text: 'Write tests' },
        ],
      }).expect(201);

      expect(res.body.checklist).toHaveLength(3);
      expect(res.body.checklist.map((c: { position: number }) => c.position)).toEqual([
        0, 1, 2,
      ]);
      expect(res.body.checklist.map((c: { text: string }) => c.text)).toEqual([
        'Create schema',
        'Implement endpoints',
        'Write tests',
      ]);

      const rows = await prisma.checklistItem.findMany({
        where: { taskId: res.body.id },
        orderBy: { position: 'asc' },
      });
      expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    });

    it('trims checklist text', async () => {
      const list = await createList();

      const res = await postTask({
        title: 'trim checklist',
        listId: list.id,
        checklist: [{ text: '   step one   ' }],
      }).expect(201);

      expect(res.body.checklist[0].text).toBe('step one');
    });

    it('returns 400 for whitespace-only checklist text', async () => {
      const list = await createList();

      const res = await postTask({
        title: 'bad checklist',
        listId: list.id,
        checklist: [{ text: '   ' }],
      }).expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.join(' ')).toContain('text');
    });

    it('accepts the Inbox as a target list', async () => {
      const res = await postTask({
        title: 'task for inbox',
        listId: INBOX_LIST_ID,
      }).expect(201);

      expect(res.body.listId).toBe(INBOX_LIST_ID);
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('creates the task and its checklist atomically', async () => {
      const list = await createList();
      const tasksBefore = await prisma.task.count();
      const itemsBefore = await prisma.checklistItem.count();

      // Force the checklist insert to fail so the transaction must roll the
      // task back; without a real failure this cannot be observed.
      await dropForcedFailure();
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION forced_checklist_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER forced_checklist_failure BEFORE INSERT ON "ChecklistItem" FOR EACH ROW EXECUTE FUNCTION forced_checklist_failure()`,
      );

      try {
        const res = await postTask({
          title: 'atomic',
          listId: list.id,
          checklist: [{ text: 'never persisted' }],
        });

        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(await prisma.task.count()).toBe(tasksBefore);
        expect(await prisma.checklistItem.count()).toBe(itemsBefore);
      } finally {
        await dropForcedFailure();
      }
    });
  });

  async function dropForcedFailure(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS forced_checklist_failure ON "ChecklistItem"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS forced_checklist_failure()`,
    );
  }

  /**
   * Fixed titles and timestamps so every sort mode produces a distinct,
   * verifiable permutation:
   *   createdAt: Bravo < alpha < Charlie
   *   title:     alpha < Bravo < Charlie (case-insensitive)
   */
  async function createSortFixtures(listId: string) {
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const specs = [
      { title: 'Bravo', offset: 0 },
      { title: 'alpha', offset: 60_000 },
      { title: 'Charlie', offset: 120_000 },
    ];

    const created = [];
    for (const spec of specs) {
      const at = new Date(base + spec.offset);
      created.push(
        await prisma.task.create({
          data: {
            title: spec.title,
            listId,
            createdAt: at,
            updatedAt: at,
          },
        }),
      );
    }

    return created;
  }
});
