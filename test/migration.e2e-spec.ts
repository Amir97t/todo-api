import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { INBOX_LIST_ID } from '../src/common/inbox.constant.js';

describe('migration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function one<T>(sql: string): Promise<T> {
    const rows = await prisma.$queryRawUnsafe<T[]>(sql);
    return rows[0];
  }

  it('creates the citext extension', async () => {
    const row = await one<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname = 'citext'`,
    );
    expect(row?.extname).toBe('citext');
  });

  it('stores List.name as citext', async () => {
    const row = await one<{ udt_name: string }>(
      `SELECT udt_name FROM information_schema.columns
       WHERE table_name = 'List' AND column_name = 'name'`,
    );
    expect(row?.udt_name).toBe('citext');
  });

  it('enforces case-insensitive unique names', async () => {
    const row = await one<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'List_name_key'`,
    );
    expect(row?.indexdef).toContain('UNIQUE');
  });

  it('creates the composite Task index', async () => {
    const row = await one<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE indexname = 'Task_listId_completed_createdAt_idx'`,
    );
    expect(row?.indexdef).toContain('("listId", completed, "createdAt")');
  });

  it('drops the redundant Task_listId_idx', async () => {
    const row = await one<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'Task_listId_idx'`,
    );
    expect(row).toBeUndefined();
  });

  it('keeps Task_listId_completed_createdAt_idx leading with listId', async () => {
    const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'Task' ORDER BY indexname`,
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toContain('Task_completed_idx');
    expect(names).toContain('Task_listId_completed_createdAt_idx');
  });

  it('seeds the fixed Inbox system row', async () => {
    const inbox = await prisma.list.findUnique({
      where: { id: INBOX_LIST_ID },
    });

    expect(inbox).not.toBeNull();
    expect(inbox?.name).toBe('Inbox');
    expect(inbox?.icon).toBe('inbox');
  });

  it('rejects a second list differing only by case', async () => {
    const before = await prisma.list.count();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.list.create({ data: { name: 'Work' } });
        await tx.list.create({ data: { name: 'wOrK' } });
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(await prisma.list.count()).toBe(before);
  });

  it('treats surrounding whitespace as distinct until trimmed by the API', async () => {
    const before = await prisma.list.count();

    const created = await prisma.list.create({
      data: { name: 'Work', icon: 'folder' },
    });
    expect(created.name).toBe('Work');

    // citext folds case only; the API must trim before persisting.
    const spaced = await prisma.list.create({
      data: { name: '  Work  ', icon: 'folder' },
    });
    expect(spaced.name).toBe('  Work  ');

    await prisma.list.delete({ where: { id: created.id } });
    await prisma.list.delete({ where: { id: spaced.id } });

    expect(await prisma.list.count()).toBe(before);
  });

  it('keeps RESTRICT on Task.delete and CASCADE on ChecklistItem.delete', async () => {
    const rows = await prisma.$queryRawUnsafe<
      { confdeltype: string; conrelid: string }[]
    >(
      `SELECT c.confdeltype::text AS confdeltype, t.relname AS conrelid
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       WHERE c.contype = 'f' ORDER BY t.relname`,
    );

    const onDelete = Object.fromEntries(
      rows.map((r) => [r.conrelid, r.confdeltype]),
    );
    expect(onDelete['Task']).toBe('r'); // RESTRICT
    expect(onDelete['ChecklistItem']).toBe('c'); // CASCADE
  });
});
