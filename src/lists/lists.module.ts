import { Module } from '@nestjs/common';
import { ListsController } from './lists.controller.js';
import { ListsService } from './lists.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [ListsController],
  providers: [ListsService],
})
export class ListsModule {}
