/**
 * Story-project member management — list / add-by-account / change-role /
 * remove. The five-rung story ladder (owner/producer/editor/reviewer/viewer)
 * and its capability matrix already existed and were already enforced on every
 * story read and write; until this service the only row anyone could hold was
 * the creator's `owner`, because project creation was the sole writer of
 * `story_project_members`.
 *
 * Authorization is the same chokepoint the rest of Story Studio uses:
 * `story.admin` to mutate, `story.read` to list. Adding also enrolls the target
 * in the owning workspace — see `ensureWorkspaceMembershipForStory` for why that
 * is mandatory rather than a convenience.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StoryProjectMemberRole,
  StoryProjectMemberStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { EntitlementService } from '../entitlements/entitlement.service';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification';
import { isUniqueViolation } from '../sharing/util';
import { removeUnusedProjectOnlyWorkspaceMembership } from '../sharing/project-workspace-membership';
import {
  acquireSeatLock,
  assertCreatorSeatAvailable,
  storyRoleConsumesCreatorSeat,
} from '../sharing/seat-guard';
import { UsersService } from '../users/users.service';
import { PlatformAuditLogService } from '../workspaces';
import { ensureWorkspaceMembershipForStory } from './story-project-membership';
import {
  STORY_ROLE_MAP,
  type AddStoryMemberInput,
  type StoryProjectMemberDto,
  type UpdateStoryMemberRoleInput,
} from './story-project-sharing.dto';
import { StoryPermissionService } from './story-permission.service';

@Injectable()
export class StoryProjectMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly users: UsersService,
    private readonly notifications: NotificationService,
    private readonly audit: PlatformAuditLogService,
    private readonly entitlements: EntitlementService,
  ) {}

  async list(
    storyProjectId: string,
    viewer: AuthUser,
    cookie: string,
  ): Promise<StoryProjectMemberDto[]> {
    await this.permissions.requireProject(
      viewer.userId,
      storyProjectId,
      'story.read',
    );
    const members = await this.prisma.storyProjectMember.findMany({
      where: {
        storyProjectId,
        removedAt: null,
        status: StoryProjectMemberStatus.active,
      },
      orderBy: [{ createdAt: 'asc' }],
    });
    const identities = await this.users.lookupByUserIds(
      members.map((m) => m.userId),
      cookie,
    );
    const byId = new Map(identities.map((i) => [i.userId, i]));
    return members.map((m) => toStoryMemberDto(m, byId.get(m.userId), viewer));
  }

  async add(
    storyProjectId: string,
    actor: AuthUser,
    cookie: string,
    input: AddStoryMemberInput,
  ): Promise<StoryProjectMemberDto> {
    const { project } = await this.permissions.requireProject(
      actor.userId,
      storyProjectId,
      'story.admin',
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
    const existing = await this.prisma.storyProjectMember.findFirst({
      where: { storyProjectId, userId: target.userId, removedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException({
        code: 'ALREADY_MEMBER',
        msg: 'That user already has access to this story.',
      });
    }

    const role = STORY_ROLE_MAP[input.role];
    try {
      const member = await this.prisma.$transaction(async (tx) => {
        await ensureWorkspaceMembershipForStory(tx, {
          workspaceId: project.workspaceId,
          userId: target.userId,
          actorUserId: actor.userId,
          role,
          entitlements: this.entitlements,
          allowReactivatingRemoved: true,
        });
        const removed = await tx.storyProjectMember.findFirst({
          where: {
            storyProjectId,
            userId: target.userId,
            removedAt: { not: null },
          },
          select: { id: true },
        });
        // The (project,user) pair is unique, so a prior removal has to be
        // re-activated rather than re-inserted.
        const m = removed
          ? await tx.storyProjectMember.update({
              where: { id: removed.id },
              data: {
                role,
                status: StoryProjectMemberStatus.active,
                removedAt: null,
                grantedByUserId: actor.userId,
              },
            })
          : await tx.storyProjectMember.create({
              data: {
                storyProjectId,
                userId: target.userId,
                role,
                status: StoryProjectMemberStatus.active,
                grantedByUserId: actor.userId,
              },
            });
        await this.notifications.send(
          {
            userId: target.userId,
            type: 'story-project.member.added',
            title: `You were added to "${project.title}"`,
            body: 'You can now open this story in Interactive Film Studio.',
            meta: {
              deeplink: `/story-studio/projects/${storyProjectId}/canvas`,
              storyProjectId,
            },
            idempotencyKey: `story-project.member.added:${m.id}:${m.updatedAt.getTime()}`,
          },
          tx,
        );
        return m;
      });
      await this.audit.record({
        workspaceId: project.workspaceId,
        actorUserId: actor.userId,
        action: 'story_project.member.added',
        entityType: 'story_project_member',
        entityId: member.id,
        after: { storyProjectId, userId: target.userId, role },
      });
      return toStoryMemberDto(member, target, actor);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'ALREADY_MEMBER',
          msg: 'That user already has access to this story.',
        });
      }
      throw err;
    }
  }

  async updateRole(
    storyProjectId: string,
    actor: AuthUser,
    memberId: string,
    input: UpdateStoryMemberRoleInput,
  ): Promise<StoryProjectMemberDto> {
    const { project } = await this.permissions.requireProject(
      actor.userId,
      storyProjectId,
      'story.admin',
    );
    const member = await this.requireMember(storyProjectId, memberId);
    if (member.role === StoryProjectMemberRole.owner) {
      throw new BadRequestException({
        code: 'CANNOT_MODIFY_OWNER',
        msg: 'The story owner role cannot be changed.',
      });
    }
    const nextRole = STORY_ROLE_MAP[input.role];
    const updated = await this.prisma.$transaction(async (tx) => {
      if (
        storyRoleConsumesCreatorSeat(nextRole) &&
        !storyRoleConsumesCreatorSeat(member.role)
      ) {
        await acquireSeatLock(tx, project.workspaceId);
        await assertCreatorSeatAvailable(
          tx,
          project.workspaceId,
          member.userId,
          this.entitlements,
        );
      }
      return tx.storyProjectMember.update({
        where: { id: memberId },
        data: { role: nextRole },
      });
    });
    await this.audit.record({
      workspaceId: project.workspaceId,
      actorUserId: actor.userId,
      action: 'story_project.member.role_changed',
      entityType: 'story_project_member',
      entityId: memberId,
      before: { role: member.role },
      after: { role: updated.role },
    });
    return toStoryMemberDto(updated, undefined, actor);
  }

  async remove(
    storyProjectId: string,
    actor: AuthUser,
    memberId: string,
  ): Promise<void> {
    const { project } = await this.permissions.requireProject(
      actor.userId,
      storyProjectId,
      'story.admin',
    );
    const member = await this.requireMember(storyProjectId, memberId);
    if (member.role === StoryProjectMemberRole.owner) {
      throw new BadRequestException({
        code: 'CANNOT_REMOVE_OWNER',
        msg: 'The story owner cannot be removed.',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.storyProjectMember.update({
        where: { id: memberId },
        data: {
          removedAt: new Date(),
          status: StoryProjectMemberStatus.removed,
        },
      });
      await removeUnusedProjectOnlyWorkspaceMembership(
        tx,
        project.workspaceId,
        member.userId,
      );
      await this.notifications.send(
        {
          userId: member.userId,
          type: 'story-project.member.removed',
          title: `Removed from "${project.title}"`,
          body: 'You no longer have access to this story.',
          meta: { deeplink: `/story-studio`, storyProjectId },
          idempotencyKey: `story-project.member.removed:${memberId}:${Date.now()}`,
        },
        tx,
      );
    });
    await this.audit.record({
      workspaceId: project.workspaceId,
      actorUserId: actor.userId,
      action: 'story_project.member.removed',
      entityType: 'story_project_member',
      entityId: memberId,
      before: { userId: member.userId, role: member.role },
    });
  }

  private async requireMember(storyProjectId: string, memberId: string) {
    const member = await this.prisma.storyProjectMember.findFirst({
      where: { id: memberId, storyProjectId, removedAt: null },
    });
    if (!member) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        msg: 'Member not found.',
      });
    }
    return member;
  }
}

function toStoryMemberDto(
  member: {
    id: string;
    userId: string;
    role: StoryProjectMemberRole;
    status: string;
    createdAt: Date;
  },
  identity: { nickname: string; avatar: string | null } | undefined,
  viewer: AuthUser,
): StoryProjectMemberDto {
  return {
    memberId: member.id,
    userId: member.userId,
    nickname: identity?.nickname ?? null,
    avatar: identity?.avatar ?? null,
    role: member.role,
    status: member.status,
    joinedAt: member.createdAt.toISOString(),
    isOwner: member.role === StoryProjectMemberRole.owner,
    isSelf: member.userId === viewer.userId,
  };
}
