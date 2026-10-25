import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ResourceScope } from '../common/resource-scope.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { QueryTasksDto, TaskSort } from './dto/query-tasks.dto.js';
import { Prisma } from '../generated/prisma/client.js';

export interface ChecklistItemResponse {
  id: string;
  text: string;
  completed: boolean;
  position: number;
}

export interface TaskResponse {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  listId: string;
  createdAt: Date;
  updatedAt: Date;
  checklist: ChecklistItemResponse[];
}

type TaskWithChecklist = Prisma.TaskGetPayload<{
  include: { checklist: true };
}>;

const CHECKLIST_ORDER = { orderBy: { position: 'asc' } as const };

const NOT_FOUND_MESSAGE = 'List not found.';
const TASK_NOT_FOUND_MESSAGE = 'Task not found.';

@Injectable()
export class TasksService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findAll(scope: ResourceScope, query: QueryTasksDto): Promise<TaskResponse[]> {
    const where = this.buildWhere(scope, query);
    const sort = query.sort ?? 'newest';

    if (sort === 'az' || sort === 'za') {
      return this.findAllByTitle(where, sort);
    }

    const tasks = await this.prisma.task.findMany({
      where,
      orderBy: this.orderBy(sort),
      include: { checklist: CHECKLIST_ORDER },
    });

    return tasks.map((task) => this.toResponse(task));
  }

  async create(scope: ResourceScope, dto: CreateTaskDto): Promise<TaskResponse> {
    await this.assertListExists(scope, dto.listId);

    const description = dto.description ?? '';
    const completed = dto.completed ?? false;
    const checklist = dto.checklist ?? [];
    // undefined (or null) falls back to the column's now() default.
    const createdAt = dto.createdAt ? new Date(dto.createdAt) : undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title: dto.title,
          description,
          completed,
          listId: dto.listId,
          createdAt,
        },
      });

      if (checklist.length > 0) {
        await tx.checklistItem.createMany({
          data: checklist.map((item, position) => ({
            taskId: task.id,
            text: item.text,
            position,
          })),
        });
      }

      return tx.task.findUniqueOrThrow({
        where: { id: task.id },
        include: { checklist: CHECKLIST_ORDER },
      });
    });

    return this.toResponse(created);
  }

  async update(
    scope: ResourceScope,
    id: string,
    dto: UpdateTaskDto,
  ): Promise<TaskResponse> {
    const existing = await this.findScoped(scope, id);

    if (!existing) {
      throw this.notFound();
    }

    if (dto.listId !== undefined) {
      await this.assertListExists(scope, dto.listId);
    }

    const data = this.pickSuppliedFields(dto);

    if (Object.keys(data).length === 0) {
      return this.toResponse(existing);
    }

    // Explicit update of only the supplied fields: nothing is read back and
    // rewritten, so `completed` can never flip by accident.
    const updated = await this.prisma.task.update({
      where: { id },
      data,
      include: { checklist: CHECKLIST_ORDER },
    });

    return this.toResponse(updated);
  }

  async remove(scope: ResourceScope, id: string): Promise<{ id: string }> {
    const existing = await this.findScoped(scope, id);

    if (!existing) {
      throw this.notFound();
    }

    try {
      await this.prisma.task.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw this.notFound();
      }

      throw error;
    }

    return { id };
  }

  private pickSuppliedFields(dto: UpdateTaskDto): Prisma.TaskUncheckedUpdateInput {
    const data: Prisma.TaskUncheckedUpdateInput = {};

    if (dto.title !== undefined) {
      data.title = dto.title;
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
    }
    if (dto.completed !== undefined) {
      data.completed = dto.completed;
    }
    if (dto.listId !== undefined) {
      data.listId = dto.listId;
    }

    return data;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'TASK_NOT_FOUND',
      message: TASK_NOT_FOUND_MESSAGE,
    });
  }

  private ownerId(scope: ResourceScope): string | null {
    return 'userId' in scope ? scope.userId : null;
  }

  private buildWhere(scope: ResourceScope, query: QueryTasksDto): Prisma.TaskWhereInput {
    const where: Prisma.TaskWhereInput = {
      list: { userId: this.ownerId(scope) },
    };

    if (query.listId !== undefined) {
      where.listId = query.listId;
    }

    if (query.completed !== undefined) {
      where.completed = query.completed;
    }

    // An empty/whitespace-only q is already "" after @Trim, so it is treated
    // as no search rather than matching everything.
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private orderBy(
    sort: Exclude<TaskSort, 'az' | 'za'>,
  ): Prisma.TaskOrderByWithRelationInput[] {
    switch (sort) {
      case 'oldest':
        return [{ createdAt: 'asc' }, { id: 'asc' }];
      case 'newest':
      default:
        return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
  }

  /**
   * Case-insensitive title ordering. Prisma's orderBy on this schema only
   * accepts a plain 'asc'/'desc' for `title`, so the ordering runs as a
   * parameterized raw query on LOWER("title") and the matching rows are then
   * hydrated through the regular findMany/include/toResponse path.
   */
  private async findAllByTitle(
    where: Prisma.TaskWhereInput,
    sort: 'az' | 'za',
  ): Promise<TaskResponse[]> {
    const matching = await this.prisma.task.findMany({
      where,
      select: { id: true },
    });

    if (matching.length === 0) {
      return [];
    }

    const ids = matching.map((task) => task.id);

    // Two static query branches: the request's sort value only selects the
    // branch and is never interpolated into SQL. Ids are parameterized.
    const ordered =
      sort === 'az'
        ? await this.prisma.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "Task"
            WHERE "id" IN (${Prisma.join(ids)})
            ORDER BY LOWER("title") ASC, "createdAt" ASC, "id" ASC
          `
        : await this.prisma.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "Task"
            WHERE "id" IN (${Prisma.join(ids)})
            ORDER BY LOWER("title") DESC, "createdAt" ASC, "id" ASC
          `;

    const tasks = await this.prisma.task.findMany({
      where: { id: { in: ids } },
      include: { checklist: CHECKLIST_ORDER },
    });
    const byId = new Map(tasks.map((task) => [task.id, task]));

    return ordered
      .map(({ id }) => byId.get(id))
      .filter((task): task is TaskWithChecklist => task !== undefined)
      .map((task) => this.toResponse(task));
  }

  private async findScoped(
    scope: ResourceScope,
    id: string,
  ): Promise<TaskWithChecklist | null> {
    return this.prisma.task.findFirst({
      where: { id, list: { userId: this.ownerId(scope) } },
      include: { checklist: CHECKLIST_ORDER },
    });
  }

  private async assertListExists(scope: ResourceScope, listId: string): Promise<void> {
    const list = await this.prisma.list.findFirst({
      where: { id: listId, userId: this.ownerId(scope) },
      select: { id: true },
    });

    if (!list) {
      throw new NotFoundException({
        code: 'LIST_NOT_FOUND',
        message: NOT_FOUND_MESSAGE,
      });
    }
  }

  private toResponse(task: TaskWithChecklist): TaskResponse {
    return {
      id: task.id,
      title: task.title,
      // The column is nullable; the API contract is always a string so
      // frontend search never reads null.
      description: task.description ?? '',
      completed: task.completed,
      listId: task.listId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      checklist: task.checklist.map((item) => ({
        id: item.id,
        text: item.text,
        completed: item.completed,
        position: item.position,
      })),
    };
  }
}
