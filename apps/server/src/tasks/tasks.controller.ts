import { Controller, Get, Header } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { TasksService } from './tasks.service';

@Controller('api/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@CurrentUser() user: AuthUser) {
    return { code: 200, data: await this.tasks.list(user) };
  }
}
