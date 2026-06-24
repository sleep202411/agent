/**
 * RealtimeController — endpoints the browser hits to bootstrap a
 * Web PubSub connection. The browser never sees the connection
 * string; it negotiates a short-lived JWT here and uses that JWT to
 * connect to Azure directly.
 */
import {
  Controller,
  Get,
  Headers,
  Inject,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { WorkspaceMemberRole } from '@prisma/client';
import { CurrentUser } from '../../auth';
import type { AuthUser } from '../../auth';
import { WorkspacePermissionService } from '../../workspaces';
import { REALTIME_PROVIDER, type RealtimeProvider } from './realtime-provider';
import { RealtimeReplayService } from './realtime-replay.service';

@Controller('realtime')
export class RealtimeController {
  private readonly logger = new Logger(RealtimeController.name);

  constructor(
    @Inject(REALTIME_PROVIDER)
    private readonly realtime: RealtimeProvider,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly replayService: RealtimeReplayService,
  ) {}

  @Post('negotiate/entity')
  async negotiateEntity(@CurrentUser() user: AuthUser) {
    const access = await this.realtime.issueEntityClientAccess(user.userId);
    if (!access) {
      return {
        code: 503,
        message: 'realtime_unconfigured',
      };
    }
    return {
      code: 200,
      data: access,
    };
  }

  @Post('negotiate/assets')
  async negotiateAssets(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspaceHeader?: string,
  ) {
    const workspaceId = normalizeHeaderValue(workspaceHeader);
    if (workspaceId) {
      await this.workspacePermissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.viewer,
      );
    }
    const access = await this.realtime.issueAssetsClientAccess(
      user.userId,
      workspaceId,
    );
    if (!access) {
      return {
        code: 503,
        message: 'realtime_unconfigured',
      };
    }
    return {
      code: 200,
      data: access,
    };
  }

  /**
   * Unified realtime-plane negotiate (P3) for the studio's single multiplexed
   * socket: grants the user's asset stream plus, when a workspace is in context,
   * that workspace's channels (wallet, …). Same workspace permission check as
   * negotiate/assets. apps/web keeps using negotiate/assets.
   */
  @Post('negotiate/realtime')
  async negotiateRealtime(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspaceHeader?: string,
  ) {
    const workspaceId = normalizeHeaderValue(workspaceHeader);
    if (workspaceId) {
      await this.workspacePermissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.viewer,
      );
    }
    const access = await this.realtime.issueRealtimeClientAccess(
      user.userId,
      workspaceId,
    );
    if (!access) {
      return {
        code: 503,
        message: 'realtime_unconfigured',
      };
    }
    return {
      code: 200,
      data: access,
    };
  }

  /**
   * Catch-up: replay a channel's events after a sequence from the durable outbox
   * (clients call this when they detect a per-channel seq gap, e.g. after a
   * disconnect). Authorization = the same channel grant as negotiate (enforced in
   * the service).
   */
  @Get('replay')
  async replay(
    @CurrentUser() user: AuthUser,
    @Query('channel') channel?: string,
    @Query('afterSeq') afterSeq?: string,
  ) {
    if (!channel) {
      return { code: 400, message: 'channel_required' };
    }
    const after = Number(afterSeq ?? '0');
    if (!Number.isFinite(after) || after < 0) {
      return { code: 400, message: 'bad_after_seq' };
    }
    const data = await this.replayService.replay(user.userId, channel, after);
    return { code: 200, data };
  }
}

function normalizeHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim();
  return normalized || undefined;
}
