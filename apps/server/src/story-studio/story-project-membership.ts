import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
  WorkspaceType,
  type Prisma,
} from '@prisma/client';
import type { EntitlementService } from '../entitlements/entitlement.service';
import { acquireSeatLock, assertSeatAvailable } from '../sharing/seat-guard';

/**
 * Story membership is gated twice, so granting it is never a single insert.
 *
 * `story_project_member_workspace_guard` (BEFORE INSERT/UPDATE) rejects any
 * active `story_project_members` row whose user is not already an active member
 * of the project's workspace, and `StoryPermissionService.requireProject`
 * independently re-checks workspace membership on every request ("Story
 * membership never grants access outside the owning tenant"). A story
 * collaborator therefore has to hold a workspace seat — enrolling them as a
 * workspace `viewer` is the minimum that satisfies both, and it keeps seat
 * accounting honest because seats are counted on `workspace_members`.
 *
 * The visible consequence, which the share UI states outright: adding someone to
 * one story project also lets them see the team's other workspace-visible work.
 */
export async function ensureWorkspaceMembershipForStory(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    userId: string;
    actorUserId: string;
    entitlements: EntitlementService;
    /**
     * Invite links must not resurrect someone a team already offboarded; an
     * admin adding by account is a deliberate re-grant and may.
     */
    allowReactivatingRemoved: boolean;
  },
): Promise<{ created: boolean }> {
  const workspace = await tx.workspace.findFirst({
    where: { id: input.workspaceId, deletedAt: null },
    select: { id: true, type: true },
  });
  if (!workspace) {
    throw new BadRequestException({
      code: 'WORKSPACE_NOT_FOUND',
      msg: 'The owning workspace no longer exists.',
    });
  }
  if (workspace.type === WorkspaceType.personal) {
    throw new BadRequestException({
      code: 'PERSONAL_WORKSPACE_NOT_SHAREABLE',
      msg: 'Move this story into a team workspace to share it.',
    });
  }

  const existing = await tx.workspaceMember.findFirst({
    where: { workspaceId: input.workspaceId, userId: input.userId },
    select: { id: true, status: true, removedAt: true },
  });
  if (existing && existing.removedAt === null) {
    return { created: false };
  }

  if (existing && !input.allowReactivatingRemoved) {
    throw new ForbiddenException({
      code: 'REMOVED_CANNOT_REJOIN',
      msg: 'You were removed from this team. Ask an admin to add you back.',
    });
  }

  // A new occupant of a seat — take the per-workspace lock before any row lock
  // so every seat-consuming path orders identically (see seat-guard).
  await acquireSeatLock(tx, input.workspaceId);
  await assertSeatAvailable(tx, input.workspaceId, input.entitlements);

  if (existing) {
    await tx.workspaceMember.update({
      where: { id: existing.id },
      data: {
        status: WorkspaceMemberStatus.active,
        removedAt: null,
        seatAssigned: true,
        joinedAt: new Date(),
        invitedById: input.actorUserId,
      },
    });
    return { created: true };
  }

  await tx.workspaceMember.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: WorkspaceMemberRole.viewer,
      status: WorkspaceMemberStatus.active,
      seatAssigned: true,
      invitedById: input.actorUserId,
      joinedAt: new Date(),
    },
  });
  return { created: true };
}
