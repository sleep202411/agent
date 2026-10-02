import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminAuthService,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../../admin-auth';
import { Public } from '../../auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import {
  StoryPlaybackEmptyBodySchema,
  StoryPlaybackGameParamsSchema,
  StoryPlaybackOverviewQuerySchema,
  type StoryPlaybackGameParams,
  type StoryPlaybackOverviewQuery,
} from './story-playback.dto';
import { StoryPlaybackAdminService } from './story-playback-admin.service';

/** Admin surface of .cn interactive-film HLS (404 on cells without it). */
@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/interactive-film-playback')
export class StoryPlaybackAdminController {
  constructor(
    private readonly playback: StoryPlaybackAdminService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Get()
  async overview(
    @Query(new ZodValidationPipe(StoryPlaybackOverviewQuerySchema))
    query: StoryPlaybackOverviewQuery,
  ) {
    return { code: 200, data: await this.playback.overview(query) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Post('games/:gameId/retry-failed')
  @HttpCode(HttpStatus.OK)
  async retryFailed(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(StoryPlaybackGameParamsSchema))
    params: StoryPlaybackGameParams,
    @Body(new ZodValidationPipe(StoryPlaybackEmptyBodySchema)) _body: unknown,
    @Req() request: Request,
  ) {
    const data = await this.playback.retryFailed(params.gameId);
    await this.audit(
      admin,
      request,
      'admin.interactive_film.hls.retry_failed',
      params.gameId,
      {
        gameId: data.gameId,
        version: data.version,
        requeued: data.requeued.length,
        refused: data.refused.length,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  async reconcile(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(StoryPlaybackEmptyBodySchema)) _body: unknown,
    @Req() request: Request,
  ) {
    const data = await this.playback.reconcileNow();
    await this.audit(
      admin,
      request,
      'admin.interactive_film.hls.reconcile',
      'reconcile',
      {
        outcome: data.outcome,
        status: data.run?.status ?? null,
        enqueued: data.run?.stats.enqueued ?? null,
        expired: data.run?.stats.expired ?? null,
      },
    );
    return { code: 200, data };
  }

  private async audit(
    admin: AdminActor,
    request: Request,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.adminAuth.writeAudit({
      actor: admin,
      action,
      resourceType: 'interactive_film_playback',
      resourceId,
      metadata: metadata as Prisma.InputJsonObject,
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}
