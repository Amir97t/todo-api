import {
  Body,
  Controller,
  Delete,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ChecklistService } from './checklist.service.js';
import { ChecklistItemResponse } from './tasks.service.js';
import { CreateChecklistItemDto } from './dto/create-checklist-item.dto.js';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto.js';
import { ResourceScopeGuard } from '../auth/resource-scope.guard.js';
import { ResourceCsrfGuard } from '../auth/resource-csrf.guard.js';

@UseGuards(ResourceScopeGuard, ResourceCsrfGuard)
@Controller('tasks/:taskId/checklist')
export class ChecklistController {
  constructor(@Inject(ChecklistService) private readonly checklist: ChecklistService) {}

  @Post()
  create(
    @Req() req: Request,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateChecklistItemDto,
  ): Promise<ChecklistItemResponse> {
    return this.checklist.create(req.resourceScope!, taskId, dto);
  }

  @Patch(':itemId')
  update(
    @Req() req: Request,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateChecklistItemDto,
  ): Promise<ChecklistItemResponse> {
    return this.checklist.update(req.resourceScope!, taskId, itemId, dto);
  }

  @Delete(':itemId')
  remove(
    @Req() req: Request,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<{ id: string }> {
    return this.checklist.remove(req.resourceScope!, taskId, itemId);
  }
}
