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
import { ListsService, ListResponse, DeleteListResponse } from './lists.service.js';
import { CreateListDto } from './dto/create-list.dto.js';
import { UpdateListDto } from './dto/update-list.dto.js';
import {
  DeleteListQueryDto,
  DeleteStrategy,
} from './dto/delete-list-query.dto.js';
import { ResourceScopeGuard } from '../auth/resource-scope.guard.js';
import { ResourceCsrfGuard } from '../auth/resource-csrf.guard.js';

const DEFAULT_STRATEGY: DeleteStrategy = 'relocate';

@UseGuards(ResourceScopeGuard, ResourceCsrfGuard)
@Controller('lists')
export class ListsController {
  constructor(@Inject(ListsService) private readonly lists: ListsService) {}

  @Get()
  findAll(@Req() req: Request): Promise<ListResponse[]> {
    return this.lists.findAll(req.resourceScope!);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateListDto): Promise<ListResponse> {
    return this.lists.create(req.resourceScope!, dto);
  }

  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListDto,
  ): Promise<ListResponse> {
    return this.lists.update(req.resourceScope!, id, dto);
  }

  @Delete(':id')
  remove(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteListQueryDto,
  ): Promise<DeleteListResponse> {
    return this.lists.remove(req.resourceScope!, id, query.strategy ?? DEFAULT_STRATEGY);
  }
}
