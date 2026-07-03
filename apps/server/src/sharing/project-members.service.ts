/**
 * Project member management for per-project sharing — list / add-by-account /
 * change-role / remove. The project-scoped sibling of WorkspaceMembersService.
 *
 * Authorization reuses WorkspacePermissionService.requireProjectRole (admin to
 * mutate, viewer to list), which itself grants workspace admins access via the
 * fallback — so a team admin can manage per-project sharing too. Adding inserts
 * an active ProjectMember (project-specific role), letting that user co-edit
 * just this project even if they're not a workspace member. Idempotent
 * notification + audit on every change; the owner row is immutable.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectMemberRole, ProjectMemberStatus } from '@prisma/client';
import type { AuthUser } from '../auth';
import { CharacterGrantService } from '../characters/character-grant.service';
import { DocumentsGateway } from '../documents/documents.gateway';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification';
import { UsersService } from '../users/users.service';
import {
  PlatformAuditLogService,
  WorkspacePermissionService,
} from '../workspaces';
import type {
  AddMemberInput,
  AssignableRole,
  UpdateMemberRoleInput,
} from './dto';
import { toProjectMemberDTO } from './mappers';
import { isUniqueViolation } from './util';

const ROLE_MAP: Record<AssignableRole, ProjectMemberRole> = {
  admin: ProjectMemberRole.admin,
  editor: ProjectMemberRole.editor,
  viewer: ProjectMemberRole.viewer,
};

@Injectable()
export class ProjectMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly users: UsersService,
    private readonly permissions: WorkspacePermissionService,
    private readonly audit: PlatformAuditLogService,
    private readonly docs: DocumentsGateway,
    private readonly characterGrants: CharacterGrantService,
  ) {}

  async list(projectId: string, viewer: AuthUser, cookie: string) {
    await this.permissions.requireProjectRole(
      viewer.userId,
      projectId,
      ProjectMemberRole.viewer,
    );
    const members = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        removedAt: null,
        status: ProjectMemberStatus.active,
      },
      orderBy: [{ createdAt: 'asc' }],
    });
    const identities = await this.users.lookupByUserIds(
      members.map((m) => m.userId),
      cookie,
    );
    const byId = new Map(identities.map((i) => [i.userId, i]));
    return members.map((m) =>
      toProjectMemberDTO(m, byId.get(m.userId), viewer.userId),
    );
  }

  async add(
    projectId: string,
    actor: AuthUser,
    cookie: string,
    input: AddMemberInput,
  ) {
    const project = await this.permissions.requireProjectRole(
      actor.userId,
      projectId,
      ProjectMemberRole.admin,
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
    const existing = await this.prisma.projectMember.findFirst({
      where: { projectId, userId: target.userId, removedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException({
        code: 'ALREADY_MEMBER',
        msg: 'That user already has access to this project.',
      });
    }

    const role = ROLE_MAP[input.role];
    try {
      const member = await this.prisma.$transaction(async (tx) => {
        const m = await tx.projectMember.create({
          data: {
            projectId,
            userId: target.userId,
            role,
            status: ProjectMemberStatus.active,
            grantedById: actor.userId,
          },
        });
        await this.notifications.send(
          {
            userId: target.userId,
            type: 'project.member.added',
            title: `You were added to "${project.name}"`,
            body: 'You can now collaborate on this project.',
            meta: { deeplink: `/project/${projectId}`, projectId },
            idempotencyKey: `project.member.added:${m.id}`,
          },
          tx,
        );
        return m;
      });
      await this.audit.record({
        workspaceId: project.workspaceId,
        projectId,
        actorUserId: actor.userId,
        action: 'project.member.added',
        entityType: 'project_member',
        entityId: member.id,
        after: { userId: target.userId, role },
      });
      return toProjectMemberDTO(member, target, actor.userId);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'ALREADY_MEMBER',
          msg: 'That user already has access to this project.',
        });
      }
      throw err;
    }
  }

  async updateRole(
    projectId: string,
    actor: AuthUser,
    memberId: string,
    input: UpdateMemberRoleInput,
  ) {
    const project = await this.permissions.requireProjectRole(
      actor.userId,
      projectId,
      ProjectMemberRole.admin,
    );
    const member = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId, removedAt: null },
    });
    if (!member) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        msg: 'Member not found.',
      });
    }
    if (member.role === ProjectMemberRole.owner) {
      throw new BadRequestException({
        code: 'CANNOT_MODIFY_OWNER',
        msg: 'The project owner role cannot be changed.',
      });
    }
    const updated = await this.prisma.projectMember.update({
      where: { id: memberId },
      data: { role: ROLE_MAP[input.role] },
    });
    await this.audit.record({
      workspaceId: project.workspaceId,
      projectId,
      actorUserId: actor.userId,
      action: 'project.member.role_changed',
      entityType: 'project_member',
      entityId: memberId,
      before: { role: member.role },
      after: { role: updated.role },
    });
    return toProjectMemberDTO(updated, undefined, actor.userId);
  }

  async remove(projectId: string, actor: AuthUser, memberId: string) {
    const project = await this.permissions.requireProjectRole(
      actor.userId,
      projectId,
      ProjectMemberRole.admin,
    );
    const member = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId, removedAt: null },
    });
    if (!member) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        msg: 'Member not found.',
      });
    }
    if (member.role === ProjectMemberRole.owner) {
      throw new BadRequestException({
        code: 'CANNOT_REMOVE_OWNER',
        msg: 'The project owner cannot be removed.',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.projectMember.update({
        where: { id: memberId },
        data: { removedAt: new Date(), status: ProjectMemberStatus.removed },
      });
      await this.notifications.send(
        {
          userId: member.userId,
          type: 'project.member.removed',
          title: `Removed from "${project.name}"`,
          body: 'You no longer have access to this project.',
          meta: { deeplink: `/canvas`, projectId },
          idempotencyKey: `project.member.removed:${memberId}`,
        },
        tx,
      );
    });
    await this.audit.record({
      workspaceId: project.workspaceId,
      projectId,
      actorUserId: actor.userId,
      action: 'project.member.removed',
      entityType: 'project_member',
      entityId: memberId,
      before: { userId: member.userId, role: member.role },
    });

    // Drop the user's live sockets on this project's documents (the gateway
    // keeps any they still reach via a workspace-level role). Best-effort.
    try {
      const documents = await this.prisma.platformDocument.findMany({
        where: { projectId, deletedAt: null },
        select: { id: true },
      });
      await this.docs.revokeUserFromDocuments(
        documents.map((d) => d.id),
        member.userId,
      );
    } catch {
      /* live-kick is defense-in-depth; never block the removal on it */
    }

    // ⟦v2⟧ A removed member's real_person likeness authorization for THIS
    // project is withdrawn — otherwise the remaining editors keep generating
    // their face with no consent record (design v2 §5). Best-effort; the
    // grant service is self-idempotent and cancels in-flight jobs.
    try {
      await this.characterGrants.revokeGrantsOnMembershipLoss(
        member.userId,
        projectId,
      );
    } catch {
      /* never block the removal on likeness teardown */
    }
  }
}
