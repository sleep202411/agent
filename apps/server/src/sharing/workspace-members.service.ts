/**
 * Workspace member management for team collaboration — list / add-by-account
 * / change-role / remove.
 *
 * Authorization reuses WorkspacePermissionService (admin to mutate, viewer to
 * list). Adding resolves an email/phone to a Java user id server-side
 * (UsersService) then inserts an active WorkspaceMember — which, via the
 * documents access fallback (workspace role → all projects), immediately lets
 * that user co-edit every project in the workspace. Every state change pushes
 * an idempotent notification + records an audit row.
 *
 * The owner row (creator) is immutable: it can't be removed or re-roled here.
 * Any workspace can hold members, personal ones included; how many is the seat
 * policy's call alone (see entitlements/seat-policy).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ProjectMemberStatus,
  StoryProjectMemberStatus,
  WorkspaceMemberAccessScope,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { DocumentsGateway } from '../documents/documents.gateway';
import { EntitlementService } from '../entitlements/entitlement.service';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification';
import { UsersService } from '../users/users.service';
import { PlatformAuditLogService } from '../workspaces';
import { WorkspacePermissionService } from '../workspaces';
import {
  acquireSeatLock,
  assertCreatorSeatAvailable,
  workspaceRoleConsumesCreatorSeat,
} from './seat-guard';
import { enqueueTeamMemberChanged } from './team-realtime';
import { RealtimeRevokeService } from '../infra/realtime/realtime-revoke.service';
import type {
  AddMemberInput,
  AssignableRole,
  UpdateMemberRoleInput,
} from './dto';
import { toWorkspaceMemberDTO } from './mappers';
import { isUniqueViolation } from './util';

const ROLE_MAP: Record<AssignableRole, WorkspaceMemberRole> = {
  admin: WorkspaceMemberRole.admin,
  editor: WorkspaceMemberRole.editor,
  viewer: WorkspaceMemberRole.viewer,
};

@Injectable()
export class WorkspaceMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly users: UsersService,
    private readonly permissions: WorkspacePermissionService,
    private readonly audit: PlatformAuditLogService,
    private readonly docs: DocumentsGateway,
    private readonly entitlements: EntitlementService,
    private readonly realtimeRevoke: RealtimeRevokeService,
  ) {}

  async list(workspaceId: string, viewer: AuthUser, cookie: string) {
    await this.permissions.requireWorkspaceRole(
      viewer.userId,
      workspaceId,
      WorkspaceMemberRole.viewer,
    );
    const members = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        removedAt: null,
        status: WorkspaceMemberStatus.active,
      },
      orderBy: [{ joinedAt: 'asc' }],
    });
    const identities = await this.users.lookupByUserIds(
      members.map((m) => m.userId),
      cookie,
    );
    const byId = new Map(identities.map((i) => [i.userId, i]));
    return members.map((m) =>
      toWorkspaceMemberDTO(m, byId.get(m.userId), viewer.userId),
    );
  }

  async add(
    workspaceId: string,
    actor: AuthUser,
    cookie: string,
    input: AddMemberInput,
  ) {
    const workspace = await this.requireWorkspace(workspaceId);
    await this.permissions.requireWorkspaceRole(
      actor.userId,
      workspaceId,
      WorkspaceMemberRole.admin,
    );

    const target = await this.users.lookupByContact({
      account: input.account,
      cookie,
    });
    if (!target) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        msg: 'No user matches that email or phone.',
        field: 'account',
      });
    }
    const existing = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: target.userId, removedAt: null },
      select: { id: true, accessScope: true },
    });
    if (existing?.accessScope === WorkspaceMemberAccessScope.workspace) {
      throw new BadRequestException({
        code: 'ALREADY_MEMBER',
        msg: 'That user is already a member of this workspace.',
      });
    }

    const role = ROLE_MAP[input.role];
    try {
      const member = await this.prisma.$transaction(async (tx) => {
        if (workspaceRoleConsumesCreatorSeat(role)) {
          await acquireSeatLock(tx, workspaceId);
          await assertCreatorSeatAvailable(
            tx,
            workspaceId,
            target.userId,
            this.entitlements,
          );
        }
        const memberData = {
          role,
          status: WorkspaceMemberStatus.active,
          accessScope: WorkspaceMemberAccessScope.workspace,
          invitedById: actor.userId,
          joinedAt: new Date(),
        } as const;
        const m = existing
          ? await tx.workspaceMember.update({
              where: { id: existing.id },
              data: memberData,
            })
          : await tx.workspaceMember.create({
              data: {
                workspaceId,
                userId: target.userId,
                ...memberData,
              },
            });
        await this.notifications.send(
          {
            userId: target.userId,
            type: 'workspace.member.added',
            title: `You were added to "${workspace.name}"`,
            body: "You can now collaborate on this team's projects.",
            meta: { deeplink: `/canvas?ws=${workspaceId}`, workspaceId },
            idempotencyKey: `workspace.member.added:${m.id}`,
          },
          tx,
        );
        await enqueueTeamMemberChanged(tx, {
          workspaceId,
          action: 'added',
          member: {
            id: m.id,
            userId: m.userId,
            role: m.role,
            status: m.status,
          },
          actorUserId: actor.userId,
        });
        return m;
      });
      await this.audit.record({
        workspaceId,
        actorUserId: actor.userId,
        action: 'workspace.member.added',
        entityType: 'workspace_member',
        entityId: member.id,
        after: { userId: target.userId, role },
      });
      return toWorkspaceMemberDTO(member, target, actor.userId);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'ALREADY_MEMBER',
          msg: 'That user is already a member of this workspace.',
        });
      }
      throw err;
    }
  }

  async updateRole(
    workspaceId: string,
    actor: AuthUser,
    memberId: string,
    input: UpdateMemberRoleInput,
  ) {
    await this.permissions.requireWorkspaceRole(
      actor.userId,
      workspaceId,
      WorkspaceMemberRole.admin,
    );
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId, removedAt: null },
    });
    if (!member) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        msg: 'Member not found.',
      });
    }
    if (member.role === WorkspaceMemberRole.owner) {
      throw new BadRequestException({
        code: 'CANNOT_MODIFY_OWNER',
        msg: 'The workspace owner role cannot be changed.',
      });
    }
    const nextRole = ROLE_MAP[input.role];
    const updated = await this.prisma.$transaction(async (tx) => {
      if (
        workspaceRoleConsumesCreatorSeat(nextRole) &&
        !workspaceRoleConsumesCreatorSeat(member.role)
      ) {
        await acquireSeatLock(tx, workspaceId);
        await assertCreatorSeatAvailable(
          tx,
          workspaceId,
          member.userId,
          this.entitlements,
        );
      }
      const u = await tx.workspaceMember.update({
        where: { id: memberId },
        data: {
          role: nextRole,
          accessScope: WorkspaceMemberAccessScope.workspace,
        },
      });
      // Atomic with the role write so the roster push can't diverge from state.
      await enqueueTeamMemberChanged(tx, {
        workspaceId,
        action: 'role_changed',
        member: { id: u.id, userId: u.userId, role: u.role, status: u.status },
        actorUserId: actor.userId,
      });
      return u;
    });
    await this.audit.record({
      workspaceId,
      actorUserId: actor.userId,
      action: 'workspace.member.role_changed',
      entityType: 'workspace_member',
      entityId: memberId,
      before: { role: member.role },
      after: { role: updated.role },
    });
    return toWorkspaceMemberDTO(updated, undefined, actor.userId);
  }

  async remove(workspaceId: string, actor: AuthUser, memberId: string) {
    await this.permissions.requireWorkspaceRole(
      actor.userId,
      workspaceId,
      WorkspaceMemberRole.admin,
    );
    const workspace = await this.requireWorkspace(workspaceId);
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId, removedAt: null },
    });
    if (!member) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        msg: 'Member not found.',
      });
    }
    if (member.role === WorkspaceMemberRole.owner) {
      throw new BadRequestException({
        code: 'CANNOT_REMOVE_OWNER',
        msg: 'The workspace owner cannot be removed.',
      });
    }
    if (member.accessScope === WorkspaceMemberAccessScope.project_only) {
      throw new BadRequestException({
        code: 'PROJECT_ONLY_MEMBER',
        msg: 'Remove this person from their projects instead of the workspace roster.',
      });
    }
    const removal = await this.prisma.$transaction(async (tx) => {
      const [projectAccess, storyAccess] = await Promise.all([
        tx.projectMember.findFirst({
          where: {
            userId: member.userId,
            removedAt: null,
            status: ProjectMemberStatus.active,
            project: { workspaceId, deletedAt: null },
          },
          select: { id: true },
        }),
        tx.storyProjectMember.findFirst({
          where: {
            userId: member.userId,
            removedAt: null,
            status: StoryProjectMemberStatus.active,
            project: { workspaceId },
          },
          select: { id: true },
        }),
      ]);
      const keepRosterPresence = Boolean(projectAccess || storyAccess);
      const updatedMember = await tx.workspaceMember.update({
        where: { id: memberId },
        data: keepRosterPresence
          ? {
              role: WorkspaceMemberRole.viewer,
              accessScope: WorkspaceMemberAccessScope.project_only,
            }
          : {
              removedAt: new Date(),
              status: WorkspaceMemberStatus.removed,
            },
      });
      await this.notifications.send(
        {
          userId: member.userId,
          type: 'workspace.member.removed',
          title: keepRosterPresence
            ? `Workspace access changed for "${workspace.name}"`
            : `Removed from "${workspace.name}"`,
          body: keepRosterPresence
            ? 'Your workspace-wide access was removed. Your existing project access remains.'
            : 'You no longer have access to this team.',
          meta: { deeplink: `/canvas`, workspaceId },
          idempotencyKey: keepRosterPresence
            ? `workspace.member.workspace_access_removed:${memberId}`
            : `workspace.member.removed:${memberId}`,
        },
        tx,
      );
      await enqueueTeamMemberChanged(tx, {
        workspaceId,
        action: keepRosterPresence ? 'role_changed' : 'removed',
        member: {
          id: updatedMember.id,
          userId: updatedMember.userId,
          role: updatedMember.role,
          status: updatedMember.status,
        },
        actorUserId: actor.userId,
      });
      return keepRosterPresence;
    });
    await this.audit.record({
      workspaceId,
      actorUserId: actor.userId,
      action: removal
        ? 'workspace.member.workspace_access_removed'
        : 'workspace.member.removed',
      entityType: 'workspace_member',
      entityId: memberId,
      before: { userId: member.userId, role: member.role },
      after: removal
        ? { role: WorkspaceMemberRole.viewer, accessScope: 'project_only' }
        : undefined,
    });
    // Kick the removed user's live sockets off the workspace channels NOW (don't
    // wait for their token to expire). Best-effort; the token TTL is the backstop.
    void this.realtimeRevoke.revokeWorkspaceAccess(workspaceId, member.userId);

    // Drop the user's live document sockets across this workspace (the gateway
    // re-checks per document and keeps any they still reach via a direct
    // project grant). Best-effort — writes are already blocked server-side.
    try {
      const documents = await this.prisma.platformDocument.findMany({
        where: { deletedAt: null, project: { workspaceId, deletedAt: null } },
        select: { id: true },
      });
      await this.docs.revokeUserFromDocuments(
        documents.map((d) => d.id),
        member.userId,
      );
    } catch {
      /* live-kick is defense-in-depth; never block the removal on it */
    }
  }

  private async requireWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true, name: true, ownerUserId: true },
    });
    if (!ws) {
      throw new NotFoundException({
        code: 'WORKSPACE_NOT_FOUND',
        msg: 'Workspace not found.',
      });
    }
    return ws;
  }
}
