import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ListsService, ListResponse, DeleteListResponse } from './lists.service.js';
import { CreateListDto } from './dto/create-list.dto.js';
import { UpdateListDto } from './dto/update-list.dto.js';
import {
  DeleteListQueryDto,
  DeleteStrategy,
} from './dto/delete-list-query.dto.js';

const DEFAULT_STRATEGY: DeleteStrategy = 'relocate';

@Controller('lists')
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Get()
  findAll(): Promise<ListResponse[]> {
    return this.lists.findAll();
  }

  @Post()
  create(@Body() dto: CreateListDto): Promise<ListResponse> {
    return this.lists.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListDto,
  ): Promise<ListResponse> {
    return this.lists.update(id, dto);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteListQueryDto,
  ): Promise<DeleteListResponse> {
    return this.lists.remove(id, query.strategy ?? DEFAULT_STRATEGY);
  }
}
