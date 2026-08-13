import { BadRequestException } from '@nestjs/common';
import { StoryProjectMemberRole, type Prisma } from '@prisma/client';
import type { EntitlementService } from '../entitlements/entitlement.service';
import { ensureProjectOnlyWorkspaceMembership } from '../sharing/project-workspace-membership';
import {
  acquireSeatLock,
  assertCreatorSeatAvailable,
  storyRoleConsumesCreatorSeat,
} from '../sharing/seat-guard';

/**
 * Story collaborators appear in the workspace personnel directory but retain
 * project-only access. Producer/editor roles consume one unique creator seat;
 * reviewer/viewer roles do not.
 */
export async function ensureWorkspaceMembershipForStory(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    userId: string;
    actorUserId: string;
    role: StoryProjectMemberRole;
    entitlements: EntitlementService;
    allowReactivatingRemoved: boolean;
  },
): Promise<void> {
  const workspace = await tx.workspace.findFirst({
    where: { id: input.workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!workspace) {
    throw new BadRequestException({
      code: 'WORKSPACE_NOT_FOUND',
      msg: 'The owning workspace no longer exists.',
    });
  }

  if (storyRoleConsumesCreatorSeat(input.role)) {
    await acquireSeatLock(tx, input.workspaceId);
    await assertCreatorSeatAvailable(
      tx,
      input.workspaceId,
      input.userId,
      input.entitlements,
    );
  }

  await ensureProjectOnlyWorkspaceMembership(tx, input);
}
