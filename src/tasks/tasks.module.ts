import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { ChecklistController } from './checklist.controller.js';
import { ChecklistService } from './checklist.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TasksController, ChecklistController],
  providers: [TasksService, ChecklistService],
})
export class TasksModule {}
