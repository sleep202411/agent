/**
 * Story-project invite links — create / list / revoke / accept. Same bearer
 * model as ProjectInvitesService (store only the sha256, return the raw token
 * once, multi-use until revoke/expiry, lazy expiry, idempotent per-user accept),
 * but it grants a StoryProjectMemberRole and enrolls the recipient in the owning
 * workspace, which the story membership trigger requires.
 *
 * Offboarding is preserved in both directions: someone removed from the story,
 * or from the team, cannot walk back in through a link that is still live.
 */
import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StoryProjectInviteStatus,
  StoryProjectMemberStatus,
  StoryProjectStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { EntitlementService } from '../entitlements/entitlement.service';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification';
import { generateInviteToken } from '../sharing/invite-token';
import type { InvitePreviewDTO } from '../sharing/mappers';
import {
  effectiveInviteStatus,
  isUniqueViolation,
  existingInviteAccess,
  resolveInviteExpiresAt,
} from '../sharing/util';
import {
  acquireSeatLock,
  storyRoleConsumesCreatorSeat,
} from '../sharing/seat-guard';
import { PlatformAuditLogService } from '../workspaces';
import { ensureWorkspaceMembershipForStory } from './story-project-membership';
import {
  STORY_ROLE_MAP,
  type CreateStoryInviteInput,
  type StoryProjectInviteDto,
} from './story-project-sharing.dto';
import { StoryPermissionService } from './story-permission.service';

@Injectable()
export class StoryProjectInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly audit: PlatformAuditLogService,
    private readonly notifications: NotificationService,
    private readonly entitlements: EntitlementService,
  ) {}

  async create(
    storyProjectId: string,
    actor: AuthUser,
    input: CreateStoryInviteInput,
  ) {
    const { project } = await this.permissions.requireProject(
      actor.userId,
      storyProjectId,
      'story.admin',
    );
    const role = STORY_ROLE_MAP[input.role];
    const { token, tokenHash } = generateInviteToken();
    const expiresAt = resolveInviteExpiresAt(input.expiresInDays);
    const invite = await this.prisma.storyProjectInvite.create({
      data: {
        storyProjectId,
        role,
        tokenHash,
        status: StoryProjectInviteStatus.pending,
        invitedByUserId: actor.userId,
        expiresAt,
      },
    });
    await this.audit.record({
      workspaceId: project.workspaceId,
      actorUserId: actor.userId,
      action: 'story_project.invite.created',
      entityType: 'story_project_invite',
      entityId: invite.id,
      after: {
        storyProjectId,
        role,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    });
    return {
      inviteId: invite.id,
      token,
      role: invite.role,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    };
  }

  async list(
    storyProjectId: string,
    actor: AuthUser,
  ): Promise<StoryProjectInviteDto[]> {
    await this.permissions.requireProject(
      actor.userId,
      storyProjectId,
      'story.admin',
    );
    const invites = await this.prisma.storyProjectInvite.findMany({
      where: { storyProjectId, status: StoryProjectInviteStatus.pending },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => ({
      inviteId: i.id,
      role: i.role,
      status: effectiveInviteStatus(i),
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt?.toISOString() ?? null,
    }));
  }

  async revoke(
    storyProjectId: string,
    actor: AuthUser,
    inviteId: string,
  ): Promise<void> {
    const { project } = await this.permissions.requireProject(
      actor.userId,
      storyProjectId,
      'story.admin',
    );
    const invite = await this.prisma.storyProjectInvite.findFirst({
      where: {
        id: inviteId,
        storyProjectId,
        status: StoryProjectInviteStatus.pending,
      },
    });
    if (!invite) {
      throw new NotFoundException({
        code: 'INVITE_NOT_FOUND',
        msg: 'Invite not found or already closed.',
      });
    }
    await this.prisma.storyProjectInvite.update({
      where: { id: inviteId },
      data: {
        status: StoryProjectInviteStatus.revoked,
        revokedAt: new Date(),
      },
    });
    await this.audit.record({
      workspaceId: project.workspaceId,
      actorUserId: actor.userId,
      action: 'story_project.invite.revoked',
      entityType: 'story_project_invite',
      entityId: inviteId,
    });
  }

  findByHash(tokenHash: string) {
    return this.prisma.storyProjectInvite.findUnique({ where: { tokenHash } });
  }

  async preview(
    invite: NonNullable<Awaited<ReturnType<this['findByHash']>>>,
    user: AuthUser,
  ): Promise<InvitePreviewDTO> {
    const project = await this.prisma.storyProject.findFirst({
      where: { id: invite.storyProjectId },
      select: { title: true },
    });
    const existingAccess = await existingInviteAccess(async () => {
      const { project } = await this.permissions.requireProject(
        user.userId,
        invite.storyProjectId,
        'story.read',
      );
      return {
        scope: 'story-project' as const,
        storyProjectId: project.id,
        workspaceId: project.workspaceId,
        targetName: project.title,
      };
    });
    return {
      existingAccess,
      scope: 'story-project',
      targetName: project?.title ?? 'a story',
      role: invite.role,
      status: effectiveInviteStatus(invite),
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    };
  }

  async accept(
    invite: NonNullable<Awaited<ReturnType<this['findByHash']>>>,
    user: AuthUser,
  ): Promise<{
    scope: 'story-project';
    storyProjectId: string;
    workspaceId: string;
    targetName: string;
  }> {
    const project = await this.requireProject(invite.storyProjectId);

    const current = await this.prisma.storyProjectInvite.findUnique({
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
        // Keep the same lock order as add-by-account and generic project
        // invites: workspace creator-seat lock before the invite row lock.
        if (storyRoleConsumesCreatorSeat(current.role)) {
          await acquireSeatLock(tx, project.workspaceId);
        }
        const locked = await tx.$queryRaw<
          { status: StoryProjectInviteStatus; expires_at: Date | null }[]
        >`SELECT status, expires_at FROM story_project_invites WHERE id = ${invite.id}::uuid FOR UPDATE`;
        const row = locked[0];
        if (
          !row ||
          row.status !== StoryProjectInviteStatus.pending ||
          (row.expires_at !== null && row.expires_at.getTime() <= Date.now())
        ) {
          throw new GoneException({
            code: 'INVITE_NOT_ACTIVE',
            msg: 'This invite link is no longer active.',
          });
        }

        const active = await tx.storyProjectMember.findFirst({
          where: {
            storyProjectId: invite.storyProjectId,
            userId: user.userId,
            removedAt: null,
          },
          select: { id: true },
        });
        if (active) return; // already a member — idempotent no-op

        const removed = await tx.storyProjectMember.findFirst({
          where: {
            storyProjectId: invite.storyProjectId,
            userId: user.userId,
            removedAt: { not: null },
          },
          select: { id: true },
        });
        if (removed) {
          throw new ForbiddenException({
            code: 'REMOVED_CANNOT_REJOIN',
            msg: 'You were removed from this story. Ask an admin to re-invite you.',
          });
        }

        await ensureWorkspaceMembershipForStory(tx, {
          workspaceId: project.workspaceId,
          userId: user.userId,
          actorUserId: current.invitedByUserId,
          role: current.role,
          entitlements: this.entitlements,
          allowReactivatingRemoved: false,
        });

        await tx.storyProjectMember.create({
          data: {
            storyProjectId: invite.storyProjectId,
            userId: user.userId,
            role: current.role,
            status: StoryProjectMemberStatus.active,
            grantedByUserId: current.invitedByUserId,
          },
        });
        await tx.storyProjectInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });
        await this.notifications.send(
          {
            userId: current.invitedByUserId,
            type: 'story-project.member.added',
            title: `Someone joined "${project.title}"`,
            body: 'An invite link to this story was accepted.',
            meta: {
              deeplink: `/story-studio/projects/${invite.storyProjectId}/canvas`,
              storyProjectId: invite.storyProjectId,
            },
            idempotencyKey: `story-project.invite.accepted:${invite.id}:${user.userId}`,
          },
          tx,
        );
        created = true;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A unique failure can roll back any write in the transaction. Only an
      // independently committed access grant makes this an idempotent success.
      const hasAccess = await existingInviteAccess(async () => {
        await this.permissions.requireProject(
          user.userId,
          invite.storyProjectId,
          'story.read',
        );
        return true;
      });
      if (!hasAccess) throw err;
    }

    await this.audit.record({
      workspaceId: project.workspaceId,
      actorUserId: user.userId,
      action: 'story_project.invite.accepted',
      entityType: 'story_project_invite',
      entityId: invite.id,
      after: {
        storyProjectId: invite.storyProjectId,
        userId: user.userId,
        role: current.role,
        created,
      },
    });

    return {
      scope: 'story-project',
      storyProjectId: invite.storyProjectId,
      workspaceId: project.workspaceId,
      targetName: project.title,
    };
  }

  private async assertUsable(invite: {
    id: string;
    status: StoryProjectInviteStatus;
    expiresAt: Date | null;
  }): Promise<void> {
    const status = effectiveInviteStatus(invite);
    if (status === StoryProjectInviteStatus.revoked) {
      throw new GoneException({
        code: 'INVITE_REVOKED',
        msg: 'This invite link has been revoked.',
      });
    }
    if (status === 'expired') {
      if (invite.status === StoryProjectInviteStatus.pending) {
        await this.prisma.storyProjectInvite
          .update({
            where: { id: invite.id },
            data: { status: StoryProjectInviteStatus.expired },
          })
          .catch(() => undefined);
      }
      throw new GoneException({
        code: 'INVITE_EXPIRED',
        msg: 'This invite link has expired.',
      });
    }
    if (status === StoryProjectInviteStatus.accepted) {
      throw new GoneException({
        code: 'INVITE_NOT_ACTIVE',
        msg: 'This invite link is no longer active.',
      });
    }
  }

  private async requireProject(storyProjectId: string) {
    const project = await this.prisma.storyProject.findFirst({
      where: { id: storyProjectId, status: StoryProjectStatus.active },
      select: { id: true, title: true, workspaceId: true },
    });
    if (!project) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        msg: 'Story project not found.',
      });
    }
    return project;
  }
}
