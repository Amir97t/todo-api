import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ChecklistService } from './checklist.service.js';
import { ChecklistItemResponse } from './tasks.service.js';
import { CreateChecklistItemDto } from './dto/create-checklist-item.dto.js';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto.js';

@Controller('tasks/:taskId/checklist')
export class ChecklistController {
  constructor(private readonly checklist: ChecklistService) {}

  @Post()
  create(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateChecklistItemDto,
  ): Promise<ChecklistItemResponse> {
    return this.checklist.create(taskId, dto);
  }

  @Patch(':itemId')
  update(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateChecklistItemDto,
  ): Promise<ChecklistItemResponse> {
    return this.checklist.update(taskId, itemId, dto);
  }

  @Delete(':itemId')
  remove(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<{ id: string }> {
    return this.checklist.remove(taskId, itemId);
  }
}
