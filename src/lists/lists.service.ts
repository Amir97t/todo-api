import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { INBOX_LIST_ID } from '../common/inbox.constant.js';
import { CreateListDto } from './dto/create-list.dto.js';
import { UpdateListDto } from './dto/update-list.dto.js';
import { DeleteStrategy } from './dto/delete-list-query.dto.js';
import { Prisma } from '../generated/prisma/client.js';

const LIST_SELECT = {
  id: true,
  name: true,
  icon: true,
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

  async findAll(): Promise<ListResponse[]> {
    const lists = await this.prisma.list.findMany({
      select: LIST_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const inbox = lists.filter((list) => list.id === INBOX_LIST_ID);
    const custom = lists.filter((list) => list.id !== INBOX_LIST_ID);

    return [...inbox, ...custom];
  }

  async create(dto: CreateListDto): Promise<ListResponse> {
    await this.assertNameAvailable(dto.name);

    return this.prisma.list
      .create({
        data: { name: dto.name, icon: dto.icon },
        select: LIST_SELECT,
      })
      .catch((error: unknown) => {
        throw this.translateConstraint(error);
      });
  }

  async update(id: string, dto: UpdateListDto): Promise<ListResponse> {
    const list = await this.findOrFail(id);
    this.assertMutable(list.id);

    if (dto.name !== undefined) {
      await this.assertNameAvailable(dto.name, id);
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

  async remove(id: string, strategy: DeleteStrategy): Promise<DeleteListResponse> {
    const list = await this.findOrFail(id);
    this.assertMutable(list.id);

    if (strategy === 'delete') {
      const [deletedTasks] = await this.prisma.$transaction([
        this.prisma.task.deleteMany({ where: { listId: id } }),
        this.prisma.list.delete({ where: { id } }),
      ]);

      return { id, strategy, tasksAffected: deletedTasks.count };
    }

    const [relocatedTasks] = await this.prisma.$transaction([
      this.prisma.task.updateMany({
        where: { listId: id },
        data: { listId: INBOX_LIST_ID },
      }),
      this.prisma.list.delete({ where: { id } }),
    ]);

    return { id, strategy, tasksAffected: relocatedTasks.count };
  }

  private async findOrFail(id: string) {
    const list = await this.prisma.list.findUnique({ where: { id } });

    if (!list) {
      throw new NotFoundException({
        code: 'LIST_NOT_FOUND',
        message: NOT_FOUND_MESSAGE,
      });
    }

    return list;
  }

  private assertMutable(id: string): void {
    if (id === INBOX_LIST_ID) {
      throw new ForbiddenException({
        code: 'INBOX_IMMUTABLE',
        message: INBOX_MESSAGE,
      });
    }
  }

  private async assertNameAvailable(name: string, excludeId?: string) {
    const clash = await this.prisma.list.findFirst({
      where: {
        name,
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
