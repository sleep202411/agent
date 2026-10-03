/**
 * Project invite links — create / list / revoke / accept. The project-scoped
 * sibling of WorkspaceInvitesService: same bearer-token model (store only
 * sha256, return raw once, multi-use until revoke/expiry, lazy expiry,
 * idempotent per-user accept), but grants a per-project ProjectMember role
 * rather than workspace membership. Unlike workspaces, any project (even one in
 * a default workspace) is shareable per-project.
 */
import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PlatformProjectStatus,
  ProjectInviteStatus,
  ProjectMemberRole,
  ProjectMemberStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { EntitlementService } from '../entitlements/entitlement.service';
import { PrismaService } from '../infra/db/db.module';
import {
  PlatformAuditLogService,
  WorkspacePermissionService,
} from '../workspaces';
import type { CreateInviteInput, AssignableRole } from './dto';
import { generateInviteToken } from './invite-token';
import { ensureProjectOnlyWorkspaceMembership } from './project-workspace-membership';
import {
  acquireSeatLock,
  assertCreatorSeatAvailable,
  projectRoleConsumesCreatorSeat,
} from './seat-guard';
import {
  toProjectInviteDTO,
  type InvitePreviewDTO,
  type ShareInviteDTO,
} from './mappers';
import {
  effectiveInviteStatus,
  isUniqueViolation,
  existingInviteAccess,
  resolveInviteExpiresAt,
} from './util';

const ROLE_MAP: Record<AssignableRole, ProjectMemberRole> = {
  admin: ProjectMemberRole.admin,
  editor: ProjectMemberRole.editor,
  viewer: ProjectMemberRole.viewer,
};

@Injectable()
export class ProjectInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: WorkspacePermissionService,
    private readonly audit: PlatformAuditLogService,
    private readonly entitlements: EntitlementService,
  ) {}

  async create(projectId: string, actor: AuthUser, input: CreateInviteInput) {
    const project = await this.permissions.requireProjectRole(
      actor.userId,
      projectId,
      ProjectMemberRole.admin,
    );
    const role = ROLE_MAP[input.role];
    const { token, tokenHash } = generateInviteToken();
    const expiresAt = resolveInviteExpiresAt(input.expiresInDays);
    const invite = await this.prisma.$transaction(async (tx) => {
      const invite = await tx.projectInvite.create({
        data: {
          projectId,
          role,
          tokenHash,
          status: ProjectInviteStatus.pending,
          invitedById: actor.userId,
          expiresAt,
        },
      });
      await this.audit.record(
        {
          workspaceId: project.workspaceId,
          projectId,
          actorUserId: actor.userId,
          action: 'project.invite.created',
          entityType: 'project_invite',
          entityId: invite.id,
          after: { role, expiresAt: expiresAt?.toISOString() ?? null },
        },
        tx,
      );
      return invite;
    });
    return {
      inviteId: invite.id,
      token,
      role: invite.role,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    };
  }

  async list(projectId: string, actor: AuthUser): Promise<ShareInviteDTO[]> {
    await this.permissions.requireProjectRole(
      actor.userId,
      projectId,
      ProjectMemberRole.admin,
    );
    const invites = await this.prisma.projectInvite.findMany({
      where: { projectId, status: ProjectInviteStatus.pending },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => ({
      ...toProjectInviteDTO(i),
      status: effectiveInviteStatus(i),
    }));
  }

  async revoke(
    projectId: string,
    actor: AuthUser,
    inviteId: string,
  ): Promise<void> {
    const project = await this.permissions.requireProjectRole(
      actor.userId,
      projectId,
      ProjectMemberRole.admin,
    );
    const invite = await this.prisma.projectInvite.findFirst({
      where: { id: inviteId, projectId, status: ProjectInviteStatus.pending },
    });
    if (!invite) {
      throw new NotFoundException({
        code: 'INVITE_NOT_FOUND',
        msg: 'Invite not found or already closed.',
      });
    }
    await this.prisma.projectInvite.update({
      where: { id: inviteId },
      data: { status: ProjectInviteStatus.revoked, revokedAt: new Date() },
    });
    await this.audit.record({
      workspaceId: project.workspaceId,
      projectId,
      actorUserId: actor.userId,
      action: 'project.invite.revoked',
      entityType: 'project_invite',
      entityId: inviteId,
    });
  }

  findByHash(tokenHash: string) {
    return this.prisma.projectInvite.findUnique({ where: { tokenHash } });
  }

  async preview(
    invite: NonNullable<Awaited<ReturnType<this['findByHash']>>>,
    user: AuthUser,
  ): Promise<InvitePreviewDTO> {
    const project = await this.prisma.platformProject.findFirst({
      where: { id: invite.projectId, deletedAt: null },
      select: { name: true },
    });
    const existingAccess = await existingInviteAccess(async () => {
      const project = await this.permissions.requireProjectRole(
        user.userId,
        invite.projectId,
        ProjectMemberRole.viewer,
      );
      return {
        scope: 'project' as const,
        projectId: project.id,
        workspaceId: project.workspaceId,
        targetName: project.name,
      };
    });
    return {
      existingAccess,
      scope: 'project',
      targetName: project?.name ?? 'a project',
      role: invite.role,
      status: effectiveInviteStatus(invite),
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    };
  }

  async accept(
    invite: NonNullable<Awaited<ReturnType<this['findByHash']>>>,
    user: AuthUser,
  ): Promise<{
    scope: 'project';
    projectId: string;
    workspaceId: string;
    targetName: string;
  }> {
    const project = await this.requireProject(invite.projectId);

    const current = await this.prisma.projectInvite.findUnique({
      where: { id: invite.id },
    });
    if (!current) {
      throw new NotFoundException({
        code: 'INVITE_NOT_FOUND',
        msg: 'This invite link is invalid.',
      });
    }
    await this.assertUsable(current);

    let created = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        if (projectRoleConsumesCreatorSeat(current.role)) {
          await acquireSeatLock(tx, project.workspaceId);
        }
        const locked = await tx.$queryRaw<
          { status: ProjectInviteStatus; expires_at: Date | null }[]
        >`SELECT status, expires_at FROM project_invites WHERE id = ${invite.id}::uuid FOR UPDATE`;
        const row = locked[0];
        if (
          !row ||
          row.status !== ProjectInviteStatus.pending ||
          (row.expires_at !== null && row.expires_at.getTime() <= Date.now())
        ) {
          throw new GoneException({
            code: 'INVITE_NOT_ACTIVE',
            msg: 'This invite link is no longer active.',
          });
        }

        const active = await tx.projectMember.findFirst({
          where: {
            projectId: invite.projectId,
            userId: user.userId,
            removedAt: null,
          },
          select: { id: true },
        });
        if (active) return; // already a member — idempotent no-op

        const removed = await tx.projectMember.findFirst({
          where: {
            projectId: invite.projectId,
            userId: user.userId,
            removedAt: { not: null },
          },
          select: { id: true },
        });
        if (removed) {
          throw new ForbiddenException({
            code: 'REMOVED_CANNOT_REJOIN',
            msg: 'You were removed from this project. Ask an admin to re-invite you.',
          });
        }

        if (projectRoleConsumesCreatorSeat(current.role)) {
          await assertCreatorSeatAvailable(
            tx,
            project.workspaceId,
            user.userId,
            this.entitlements,
          );
        }
        await ensureProjectOnlyWorkspaceMembership(tx, {
          workspaceId: project.workspaceId,
          userId: user.userId,
          actorUserId: current.invitedById,
          allowReactivatingRemoved: false,
        });

        await tx.projectMember.create({
          data: {
            projectId: invite.projectId,
            userId: user.userId,
            role: current.role,
            status: ProjectMemberStatus.active,
            grantedById: current.invitedById,
          },
        });
        await tx.projectInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });
        created = true;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A unique failure can roll back any write in the transaction. Only an
      // independently committed access grant makes this an idempotent success.
      const hasAccess = await existingInviteAccess(async () => {
        await this.permissions.requireProjectRole(
          user.userId,
          invite.projectId,
          ProjectMemberRole.viewer,
        );
        return true;
      });
      if (!hasAccess) throw err;
    }

    await this.audit.record({
      workspaceId: project.workspaceId,
      projectId: invite.projectId,
      actorUserId: user.userId,
      action: 'project.invite.accepted',
      entityType: 'project_invite',
      entityId: invite.id,
      after: { userId: user.userId, role: current.role, created },
    });

    return {
      scope: 'project',
      projectId: invite.projectId,
      workspaceId: project.workspaceId,
      targetName: project.name,
    };
  }

  private async assertUsable(invite: {
    id: string;
    status: ProjectInviteStatus;
    expiresAt: Date | null;
  }): Promise<void> {
    const status = effectiveInviteStatus(invite);
    if (status === ProjectInviteStatus.revoked) {
      throw new GoneException({
        code: 'INVITE_REVOKED',
        msg: 'This invite link has been revoked.',
      });
    }
    if (status === 'expired') {
      if (invite.status === ProjectInviteStatus.pending) {
        await this.prisma.projectInvite
          .update({
            where: { id: invite.id },
            data: { status: ProjectInviteStatus.expired },
          })
          .catch(() => undefined);
      }
      throw new GoneException({
        code: 'INVITE_EXPIRED',
        msg: 'This invite link has expired.',
      });
    }
    if (status === ProjectInviteStatus.accepted) {
      throw new GoneException({
        code: 'INVITE_NOT_ACTIVE',
        msg: 'This invite link is no longer active.',
      });
    }
  }

  private async requireProject(projectId: string) {
    const project = await this.prisma.platformProject.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
        status: PlatformProjectStatus.active,
      },
      select: { id: true, name: true, workspaceId: true },
    });
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        msg: 'Project not found.',
      });
    }
    return project;
  }
}
