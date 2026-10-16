import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ResourceScope } from '../common/resource-scope.js';
import { CreateListDto } from './dto/create-list.dto.js';
import { UpdateListDto } from './dto/update-list.dto.js';
import { DeleteStrategy } from './dto/delete-list-query.dto.js';
import { Prisma } from '../generated/prisma/client.js';

const LIST_SELECT = {
  id: true,
  name: true,
  icon: true,
  isInbox: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ListResponse = Prisma.ListGetPayload<{
  select: typeof LIST_SELECT;
}>;

export interface DeleteListResponse {
  id: string;
  strategy: DeleteStrategy;
  tasksAffected: number;
}

const INBOX_MESSAGE = 'The Inbox list cannot be modified or deleted.';
const NOT_FOUND_MESSAGE = 'List not found.';
const NAME_EXISTS_MESSAGE = 'A list with that name already exists.';

@Injectable()
export class ListsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findAll(scope: ResourceScope): Promise<ListResponse[]> {
    const lists = await this.prisma.list.findMany({
      select: LIST_SELECT,
      where: this.scopeFilter(scope),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const inbox = lists.filter((list) => list.isInbox);
    const custom = lists.filter((list) => !list.isInbox);

    return [...inbox, ...custom];
  }

  async create(scope: ResourceScope, dto: CreateListDto): Promise<ListResponse> {
    await this.assertNameAvailable(scope, dto.name);

    return this.prisma.list
      .create({
        data: {
          name: dto.name,
          icon: dto.icon,
          userId: this.ownerId(scope),
        },
        select: LIST_SELECT,
      })
      .catch((error: unknown) => {
        throw this.translateConstraint(error);
      });
  }

  async update(
    scope: ResourceScope,
    id: string,
    dto: UpdateListDto,
  ): Promise<ListResponse> {
    const list = await this.findOrFail(scope, id);
    this.assertMutable(list);

    if (dto.name !== undefined) {
      await this.assertNameAvailable(scope, dto.name, id);
    }

    return this.prisma.list
      .update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        },
        select: LIST_SELECT,
      })
      .catch((error: unknown) => {
        throw this.translateConstraint(error);
      });
  }

  async remove(
    scope: ResourceScope,
    id: string,
    strategy: DeleteStrategy,
  ): Promise<DeleteListResponse> {
    const list = await this.findOrFail(scope, id);
    this.assertMutable(list);

    if (strategy === 'delete') {
      const [deletedTasks] = await this.prisma.$transaction([
        this.prisma.task.deleteMany({ where: { listId: id } }),
        this.prisma.list.delete({ where: { id } }),
      ]);

      return { id, strategy, tasksAffected: deletedTasks.count };
    }

    const inboxId = await this.resolveRelocateTarget(scope);

    const [relocatedTasks] = await this.prisma.$transaction([
      this.prisma.task.updateMany({
        where: { listId: id },
        data: { listId: inboxId },
      }),
      this.prisma.list.delete({ where: { id } }),
    ]);

    return { id, strategy, tasksAffected: relocatedTasks.count };
  }

  private ownerId(scope: ResourceScope): string | null {
    return 'userId' in scope ? scope.userId : null;
  }

  private scopeFilter(scope: ResourceScope): Prisma.ListWhereInput {
    return { userId: this.ownerId(scope) };
  }

  /**
   * Legacy rows stay owned by null so the pre-C4-1b anonymous surface is
   * unchanged; registered users only ever see their own lists.
   */
  private async findOrFail(scope: ResourceScope, id: string) {
    const list = await this.prisma.list.findFirst({
      where: { id, ...this.scopeFilter(scope) },
    });

    if (!list) {
      throw new NotFoundException({
        code: 'LIST_NOT_FOUND',
        message: NOT_FOUND_MESSAGE,
      });
    }

    return list;
  }

  private assertMutable(list: { id: string; isInbox: boolean }): void {
    if (list.isInbox) {
      throw new ForbiddenException({
        code: 'INBOX_IMMUTABLE',
        message: INBOX_MESSAGE,
      });
    }
  }

  private async resolveRelocateTarget(scope: ResourceScope): Promise<string> {
    const inbox = await this.prisma.list.findFirst({
      where: { isInbox: true, ...this.scopeFilter(scope) },
      select: { id: true },
    });

    if (inbox) {
      return inbox.id;
    }

    // Users registered before C4-1b have no personal Inbox; create one now.
    // The List_userId_inbox_key partial unique index is the final integrity
    // guarantee — a concurrent creator loses the race and this retry picks
    // up the winner's row.
    try {
      const created = await this.prisma.list.create({
        data: {
          name: 'Inbox',
          icon: 'inbox',
          isInbox: true,
          userId: this.ownerId(scope),
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.list.findFirst({
          where: { isInbox: true, ...this.scopeFilter(scope) },
          select: { id: true },
        });
        if (winner) {
          return winner.id;
        }
      }
      throw error;
    }
  }

  private async assertNameAvailable(
    scope: ResourceScope,
    name: string,
    excludeId?: string,
  ) {
    const clash = await this.prisma.list.findFirst({
      where: {
        name,
        ...this.scopeFilter(scope),
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (clash) {
      throw new ConflictException({
        code: 'LIST_NAME_EXISTS',
        message: NAME_EXISTS_MESSAGE,
      });
    }
  }

  /**
   * The pre-check above closes the normal path; this closes the race where two
   * requests pass it simultaneously and the citext unique index rejects one.
   */
  private translateConstraint(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException({
        code: 'LIST_NAME_EXISTS',
        message: NAME_EXISTS_MESSAGE,
      });
    }

    return error;
  }
}
