import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
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

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryTasksDto): Promise<TaskResponse[]> {
    const where = this.buildWhere(query);

    const tasks = await this.prisma.task.findMany({
      where,
      orderBy: this.orderBy(query.sort ?? 'newest'),
      include: { checklist: CHECKLIST_ORDER },
    });

    return tasks.map((task) => this.toResponse(task));
  }

  async create(dto: CreateTaskDto): Promise<TaskResponse> {
    await this.assertListExists(dto.listId);

    const description = dto.description ?? '';
    const completed = dto.completed ?? false;
    const checklist = dto.checklist ?? [];

    const created = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title: dto.title,
          description,
          completed,
          listId: dto.listId,
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

  private buildWhere(query: QueryTasksDto): Prisma.TaskWhereInput {
    const where: Prisma.TaskWhereInput = {};

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

  private orderBy(sort: TaskSort): Prisma.TaskOrderByWithRelationInput[] {
    switch (sort) {
      case 'oldest':
        return [{ createdAt: 'asc' }, { id: 'asc' }];
      case 'az':
        return [{ title: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }];
      case 'za':
        return [{ title: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }];
      case 'newest':
      default:
        return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
  }

  private async assertListExists(listId: string): Promise<void> {
    const list = await this.prisma.list.findUnique({
      where: { id: listId },
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
