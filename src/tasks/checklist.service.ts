import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChecklistItemResponse } from './tasks.service.js';
import { CreateChecklistItemDto } from './dto/create-checklist-item.dto.js';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto.js';

const TASK_NOT_FOUND = 'Task not found.';
const ITEM_NOT_FOUND = 'Checklist item not found.';

@Injectable()
export class ChecklistService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    taskId: string,
    dto: CreateChecklistItemDto,
  ): Promise<ChecklistItemResponse> {
    await this.assertTaskExists(taskId);

    return this.prisma.$transaction(async (tx) => {
      // Serialises appends for this task only, so two concurrent creates
      // cannot both read the same MAX(position). Different tasks use
      // different lock keys and never contend.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${taskId}, 0))`;

      const aggregate = await tx.checklistItem.aggregate({
        where: { taskId },
        _max: { position: true },
      });

      const created = await tx.checklistItem.create({
        data: {
          taskId,
          text: dto.text,
          completed: false,
          position: (aggregate._max.position ?? -1) + 1,
        },
      });

      return this.toResponse(created);
    });
  }

  async update(
    taskId: string,
    itemId: string,
    dto: UpdateChecklistItemDto,
  ): Promise<ChecklistItemResponse> {
    await this.findOwned(taskId, itemId);

    const data: { text?: string; completed?: boolean } = {};
    if (dto.text !== undefined) data.text = dto.text;
    if (dto.completed !== undefined) data.completed = dto.completed;

    if (Object.keys(data).length === 0) {
      const current = await this.prisma.checklistItem.findUniqueOrThrow({
        where: { id: itemId },
      });
      return this.toResponse(current);
    }

    const updated = await this.prisma.checklistItem.update({
      where: { id: itemId },
      data,
    });

    return this.toResponse(updated);
  }

  async remove(taskId: string, itemId: string): Promise<{ id: string }> {
    await this.findOwned(taskId, itemId);

    await this.prisma.checklistItem.delete({ where: { id: itemId } });

    return { id: itemId };
  }

  private toResponse(item: {
    id: string;
    text: string;
    completed: boolean;
    position: number;
  }): ChecklistItemResponse {
    return {
      id: item.id,
      text: item.text,
      completed: item.completed,
      position: item.position,
    };
  }

  private async assertTaskExists(taskId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true },
    });

    if (!task) {
      throw new NotFoundException({ code: 'TASK_NOT_FOUND', message: TASK_NOT_FOUND });
    }
  }

  private async findOwned(taskId: string, itemId: string) {
    await this.assertTaskExists(taskId);

    const item = await this.prisma.checklistItem.findUnique({
      where: { id: itemId },
    });

    // An item belonging to a different task is invisible from this task's
    // point of view, so it reports the same 404 as a truly missing item.
    if (!item || item.taskId !== taskId) {
      throw new NotFoundException({
        code: 'CHECKLIST_ITEM_NOT_FOUND',
        message: ITEM_NOT_FOUND,
      });
    }

    return item;
  }
}
