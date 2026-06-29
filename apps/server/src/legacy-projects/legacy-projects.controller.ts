import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { LegacyProjectsService } from './legacy-projects.service';

// Authed by the global AuthGuard (satoken). We forward the viewer's cookie to
// the Java studio `myproduct` endpoint, which scopes results by world
// membership — see LegacyProjectsService.
@Controller('legacy-projects')
export class LegacyProjectsController {
  constructor(private readonly service: LegacyProjectsService) {}

  @Get('my')
  async myProjects(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const lim = Math.min(100, Math.max(1, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);
    const items = await this.service.listMyProjects(req.headers.cookie ?? '', {
      limit: lim,
      offset: off,
    });
    return { code: 200, data: { items } };
  }
}
