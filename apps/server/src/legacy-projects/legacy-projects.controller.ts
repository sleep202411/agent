import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { LegacyProjectsService } from './legacy-projects.service';

// Authed by the global AuthGuard (satoken). `user.userId` is the Java
// client_user id, which equals `project.admin_user_id`.
@Controller('legacy-projects')
export class LegacyProjectsController {
  constructor(private readonly service: LegacyProjectsService) {}

  @Get('my')
  async myProjects(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const lim = Math.min(100, Math.max(1, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);
    const items = await this.service.listMyProjects(user.userId, {
      limit: lim,
      offset: off,
    });
    return { code: 200, data: { items } };
  }
}
