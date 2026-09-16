import { ForbiddenException } from '@nestjs/common';
import {
  ProjectMemberStatus,
  StoryProjectMemberStatus,
  WorkspaceMemberAccessScope,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
  type Prisma,
} from '@prisma/client';

/**
 * Put a project collaborator in the workspace personnel directory without
 * granting workspace-wide project access. Existing direct workspace membership
 * always wins and is never downgraded.
 */
export async function ensureProjectOnlyWorkspaceMembership(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    userId: string;
    actorUserId: string;
    allowReactivatingRemoved: boolean;
  },
): Promise<void> {
  const active = await tx.workspaceMember.findFirst({
    where: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      removedAt: null,
    },
  });
  if (active) return;

  const removed = await tx.workspaceMember.findFirst({
    where: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      removedAt: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (removed && !input.allowReactivatingRemoved) {
    throw new ForbiddenException({
      code: 'REMOVED_CANNOT_REJOIN',
      msg: 'You were removed from this workspace. Ask an admin to add you back.',
    });
  }

  const data = {
    role: WorkspaceMemberRole.viewer,
    status: WorkspaceMemberStatus.active,
    accessScope: WorkspaceMemberAccessScope.project_only,
    removedAt: null,
    joinedAt: new Date(),
    invitedById: input.actorUserId,
  } as const;

  if (removed) {
    await tx.workspaceMember.update({ where: { id: removed.id }, data });
  } else {
    await tx.workspaceMember.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        ...data,
      },
    });
  }
}

/** Remove only the projected directory row after the user's last project ends. */
export async function removeUnusedProjectOnlyWorkspaceMembership(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const roster = await tx.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId,
      accessScope: WorkspaceMemberAccessScope.project_only,
      removedAt: null,
      status: WorkspaceMemberStatus.active,
    },
  });
  if (!roster) return;

  const [projectMembership, storyMembership] = [
    await tx.projectMember.findFirst({
      where: {
        userId,
        removedAt: null,
        status: ProjectMemberStatus.active,
        project: { workspaceId, deletedAt: null },
      },
      select: { id: true },
    }),
    await tx.storyProjectMember.findFirst({
      where: {
        userId,
        removedAt: null,
        status: StoryProjectMemberStatus.active,
        project: { workspaceId },
      },
      select: { id: true },
    }),
  ];
  if (projectMembership || storyMembership) return;

  await tx.workspaceMember.update({
    where: { id: roster.id },
    data: {
      status: WorkspaceMemberStatus.removed,
      removedAt: new Date(),
    },
  });
}
