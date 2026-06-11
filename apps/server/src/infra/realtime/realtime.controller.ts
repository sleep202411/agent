/**
 * RealtimeController — endpoints the browser hits to bootstrap a
 * Web PubSub connection. The browser never sees the connection
 * string; it negotiates a short-lived JWT here and uses that JWT to
 * connect to Azure directly.
 */
import { Controller, Headers, Logger, Post } from '@nestjs/common';
import { WorkspaceMemberRole } from '@prisma/client';
import { CurrentUser } from '../../auth';
import type { AuthUser } from '../../auth';
import { WorkspacePermissionService } from '../../workspaces';
import { WebPubSubService } from './web-pubsub.service';

@Controller('realtime')
export class RealtimeController {
  private readonly logger = new Logger(RealtimeController.name);

  constructor(
    private readonly webPubSub: WebPubSubService,
    private readonly workspacePermissions: WorkspacePermissionService,
  ) {}

  @Post('negotiate/entity')
  async negotiateEntity(@CurrentUser() user: AuthUser) {
    const access = await this.webPubSub.issueEntityClientAccess(user.userId);
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
    const access = await this.webPubSub.issueAssetsClientAccess(
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
}

function normalizeHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim();
  return normalized || undefined;
}
