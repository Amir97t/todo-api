import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { TasksService, TaskResponse } from './tasks.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { QueryTasksDto } from './dto/query-tasks.dto.js';
import { ResourceScopeGuard } from '../auth/resource-scope.guard.js';
import { ResourceCsrfGuard } from '../auth/resource-csrf.guard.js';

@UseGuards(ResourceScopeGuard, ResourceCsrfGuard)
@Controller('tasks')
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Get()
  findAll(
    @Req() req: Request,
    @Query() query: QueryTasksDto,
  ): Promise<TaskResponse[]> {
    return this.tasks.findAll(req.resourceScope!, query);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateTaskDto): Promise<TaskResponse> {
    return this.tasks.create(req.resourceScope!, dto);
  }

  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskResponse> {
    return this.tasks.update(req.resourceScope!, id, dto);
  }

  @Delete(':id')
  remove(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.tasks.remove(req.resourceScope!, id);
  }
}
