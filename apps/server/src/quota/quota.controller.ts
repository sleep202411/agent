/**
 * GET /aurora/quota — snapshot for the current user.
 *
 * Limits come from the PostgreSQL membership truth (EntitlementService:
 * grants → plan row benefits), never from external authentication claims.
 * An optional x-fizz-workspace-id header resolves workspace-scoped team
 * plans, matching how team compute credits are scoped.
 *
 * Public-shaped JSON intentionally uses string "Infinity" so JSON
 * round-trips cleanly. Frontend converts back via `parseLimit()`.
 */
import { Controller, Get, Headers } from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { EntitlementService } from '../entitlements';
import { WorkspacePermissionService } from '../workspaces';
import { QuotaService } from './quota.service';
import type { QuotaPeek, QuotaSnapshot } from './quota.types';

type WireSnapshot = Omit<QuotaSnapshot, 'limit' | 'remaining'> & {
  limit: number | 'Infinity';
  remaining: number | 'Infinity';
};

interface WirePeek {
  tier: QuotaPeek['tier'];
  planKey: string;
  dimensions: Record<string, WireSnapshot>;
  chatPerMinute: { limit: number; remaining: number; resetAt: string };
}

function toWire(peek: QuotaPeek, planKey: string): WirePeek {
  const dims: Record<string, WireSnapshot> = {};
  for (const [k, v] of Object.entries(peek.dimensions)) {
    dims[k] = {
      ...v,
      limit: Number.isFinite(v.limit) ? v.limit : 'Infinity',
      remaining: Number.isFinite(v.remaining) ? v.remaining : 'Infinity',
    };
  }
  return {
    tier: peek.tier,
    planKey,
    dimensions: dims,
    chatPerMinute: peek.chatPerMinute,
  };
}

@Controller('quota')
export class QuotaController {
  constructor(
    private readonly svc: QuotaService,
    private readonly entitlements: EntitlementService,
    private readonly workspacePermissions: WorkspacePermissionService,
  ) {}

  @Get()
  async getQuota(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
  ) {
    const workspaceId = Array.isArray(workspaceHeader)
      ? workspaceHeader[0]
      : workspaceHeader;
    if (workspaceId?.trim()) {
      await this.workspacePermissions.requireWorkspacePresence(
        user.userId,
        workspaceId.trim(),
      );
    }
    const entitlement = await this.entitlements.resolveForUser(user, {
      workspaceId: workspaceId?.trim() || null,
    });
    const profile = await this.entitlements.quotaProfileFor(entitlement);
    const peek = await this.svc.peek(user.userId, profile);
    return { code: 200, data: toWire(peek, entitlement.planKey) };
  }
}
