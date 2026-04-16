import { Module } from '@nestjs/common';
import { TaskService } from './task.service';
import { TaskQueue } from './task.queue';
import { TaskController } from './task.controller';

@Module({
  controllers: [TaskController],
  providers: [TaskService, TaskQueue],
  exports: [TaskService, TaskQueue],
})
export class TaskModule {}
