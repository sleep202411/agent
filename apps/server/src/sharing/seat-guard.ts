import { ForbiddenException } from '@nestjs/common';
import {
  ProjectMemberRole,
  StoryProjectMemberRole,
  WorkspaceMemberRole,
  type Prisma,
} from '@prisma/client';
import type { EntitlementService } from '../entitlements/entitlement.service';
import { decideSeatAdmission } from '../entitlements/seat-policy';

/** Roles that can actively create/edit production content consume a seat. */
export function workspaceRoleConsumesCreatorSeat(
  role: WorkspaceMemberRole,
): boolean {
  return (
    role === WorkspaceMemberRole.owner ||
    role === WorkspaceMemberRole.admin ||
    role === WorkspaceMemberRole.editor
  );
}

export function projectRoleConsumesCreatorSeat(
  role: ProjectMemberRole,
): boolean {
  return (
    role === ProjectMemberRole.owner ||
    role === ProjectMemberRole.admin ||
    role === ProjectMemberRole.editor
  );
}

export function storyRoleConsumesCreatorSeat(
  role: StoryProjectMemberRole,
): boolean {
  return (
    role === StoryProjectMemberRole.owner ||
    role === StoryProjectMemberRole.producer ||
    role === StoryProjectMemberRole.editor
  );
}

/** Serialize every creator-seat mutation for one workspace. */
export async function acquireSeatLock(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workspace:creator-seats:${workspaceId}`})::bigint)`;
}

/**
 * The seat pool is the set of unique creator-capable users across the whole
 * workspace. A user in several projects consumes one seat; viewers, reviewers
 * and billing-only members consume none.
 */
export async function creatorSeatUserIds(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<Set<string>> {
  const rows = await tx.$queryRaw<Array<{ user_id: string }>>`
    SELECT DISTINCT creator.user_id
    FROM (
      SELECT wm.user_id
      FROM workspace_members wm
      WHERE wm.workspace_id = ${workspaceId}::uuid
        AND wm.removed_at IS NULL
        AND wm.status = 'active'
        AND wm.access_scope = 'workspace'
        AND wm.role IN ('owner', 'admin', 'editor')

      UNION

      SELECT pm.user_id
      FROM project_members pm
      INNER JOIN platform_projects p ON p.id = pm.project_id
      WHERE p.workspace_id = ${workspaceId}::uuid
        AND p.deleted_at IS NULL
        AND pm.removed_at IS NULL
        AND pm.status = 'active'
        AND pm.role IN ('owner', 'admin', 'editor')

      UNION

      SELECT spm.user_id
      FROM story_project_members spm
      INNER JOIN story_projects sp ON sp.id = spm.story_project_id
      WHERE sp.workspace_id = ${workspaceId}::uuid
        AND spm.removed_at IS NULL
        AND spm.status = 'active'
        AND spm.role IN ('owner', 'producer', 'editor')
    ) creator
  `;
  return new Set(rows.map((row) => row.user_id));
}

/** Assert only when the requested role is creator-capable. */
export async function assertCreatorSeatAvailable(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  entitlements: EntitlementService,
): Promise<void> {
  const occupiedBy = await creatorSeatUserIds(tx, workspaceId);
  if (occupiedBy.has(userId)) return;

  const policy = await entitlements.resolveWorkspaceSeatPolicy(workspaceId, {
    tx,
  });
  const admission = decideSeatAdmission(policy, occupiedBy.size);
  if (admission.kind === 'allow') return;

  if (admission.kind === 'requires_purchase') {
    throw new ForbiddenException({
      code: 'WORKSPACE_CREATOR_SEAT_PURCHASE_REQUIRED',
      msg: 'An additional creator seat is required for this role.',
      seatPriceId: admission.seatPriceId,
      includedSeats: admission.policy.includedSeats,
      activeSeats: admission.activeSeats,
    });
  }

  throw new ForbiddenException({
    code: 'WORKSPACE_CREATOR_SEAT_LIMIT_REACHED',
    msg: admission.reason,
    planKey: admission.policy.planKey,
    includedSeats: admission.policy.includedSeats,
    maxSeats: admission.policy.maxSeats,
    activeSeats: admission.activeSeats,
  });
}
