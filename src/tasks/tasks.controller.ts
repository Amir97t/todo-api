import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { TasksService, TaskResponse } from './tasks.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { QueryTasksDto } from './dto/query-tasks.dto.js';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  findAll(@Query() query: QueryTasksDto): Promise<TaskResponse[]> {
    return this.tasks.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateTaskDto): Promise<TaskResponse> {
    return this.tasks.create(dto);
  }
}
