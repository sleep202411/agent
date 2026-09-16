import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { DocumentsGateway } from '../documents/documents.gateway';
import { RealtimeRevokeService } from '../infra/realtime/realtime-revoke.service';
import { acquireSeatLock } from '../sharing/seat-guard';
import {
  ensureProjectOnlyWorkspaceMembership,
  removeUnusedProjectOnlyWorkspaceMembership,
} from '../sharing/project-workspace-membership';
import { StoryPermissionService } from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';
import type { MoveStoryProjectInput } from './story-project-move.controller';

@Injectable()
export class StoryProjectMoveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly writeGuard: StoryProjectWriteGuardService,
    private readonly documents: DocumentsGateway,
    private readonly realtime: RealtimeRevokeService,
  ) {}

  async move(user: AuthUser, projectId: string, input: MoveStoryProjectInput) {
    await this.permissions.requireProject(user.userId, projectId, 'story.read');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      await this.writeGuard.assertAgentClaimAllowed(tx, projectId);
      const { project } = await this.permissions.requireProjectInTransaction(
        tx,
        user.userId,
        projectId,
        'story.admin',
      );
      if (
        project.workspaceId !== input.expectedWorkspaceId ||
        project.version !== input.expectedProjectVersion
      ) {
        throw new ConflictException({
          code: 'STORY_PROJECT_CHANGED',
          message: 'The project changed. Refresh it before moving it.',
        });
      }
      const owner = await tx.storyProjectMember.findFirst({
        where: {
          storyProjectId: projectId,
          userId: user.userId,
          role: 'owner',
          status: 'active',
          removedAt: null,
        },
      });
      if (!owner) {
        throw new ForbiddenException({
          code: 'STORY_PROJECT_OWNER_REQUIRED',
          message: 'Only the project owner can move this project.',
        });
      }
      if (project.workspaceId === input.targetWorkspaceId) {
        throw new ConflictException({
          code: 'STORY_PROJECT_SAME_WORKSPACE',
          message: 'Choose a different workspace.',
        });
      }
      for (const workspaceId of [
        project.workspaceId,
        input.targetWorkspaceId,
      ].sort()) {
        await acquireSeatLock(tx, workspaceId);
      }
      // Lock destination membership against concurrent removal or downgrade.
      const target = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
        WHERE w.id = ${input.targetWorkspaceId}::uuid AND w.deleted_at IS NULL AND w.status = 'active'
          AND m.user_id = ${user.userId} AND m.role IN ('owner', 'admin')
          AND m.access_scope = 'workspace' AND m.status = 'active' AND m.removed_at IS NULL
        FOR SHARE OF w, m
      `;
      if (!target.length) {
        throw new ForbiddenException({
          code: 'WORKSPACE_ADMIN_REQUIRED',
          message:
            'You must be an owner or admin of the destination workspace.',
        });
      }
      await this.assertIdle(tx, projectId);
      const members = await tx.storyProjectMember.findMany({
        where: { storyProjectId: projectId, status: 'active', removedAt: null },
        select: { userId: true },
      });
      const sourceMembers = await tx.workspaceMember.findMany({
        where: {
          workspaceId: project.workspaceId,
          status: 'active',
          removedAt: null,
        },
        select: { userId: true },
      });
      const documents = await tx.studioDocument.findMany({
        where: { storyProjectId: projectId },
        select: { id: true },
      });
      for (const member of members) {
        await ensureProjectOnlyWorkspaceMembership(tx, {
          workspaceId: input.targetWorkspaceId,
          userId: member.userId,
          actorUserId: user.userId,
          allowReactivatingRemoved: true,
        });
      }
      const unavailable = await tx.workspaceMember.count({
        where: {
          workspaceId: input.targetWorkspaceId,
          userId: { in: members.map((m) => m.userId) },
          removedAt: null,
          status: { not: 'active' },
        },
      });
      if (unavailable) {
        throw new ConflictException({
          code: 'STORY_PROJECT_MEMBER_UNAVAILABLE',
          message:
            'A project member is suspended in the destination workspace. Resolve their membership before moving.',
        });
      }
      // Composite FKs cascade live documents, layouts, skills and worlds.
      // Job/batch/audit FKs intentionally retain their historical workspace.
      const moved = await tx.storyProject.update({
        where: { id: projectId },
        data: {
          workspaceId: input.targetWorkspaceId,
          version: { increment: 1 },
        },
        select: { id: true, workspaceId: true, version: true },
      });
      await tx.agentOsAttachment.updateMany({
        where: { storyProjectId: projectId },
        data: { workspaceId: moved.workspaceId },
      });
      for (const member of members) {
        await removeUnusedProjectOnlyWorkspaceMembership(
          tx,
          project.workspaceId,
          member.userId,
        );
      }
      await tx.platformAuditLog.create({
        data: {
          workspaceId: moved.workspaceId,
          actorUserId: user.userId,
          action: 'story_project.moved',
          entityType: 'story_project',
          entityId: projectId,
          before: {
            workspaceId: project.workspaceId,
            version: project.version,
          },
          after: { workspaceId: moved.workspaceId, version: moved.version },
        },
      });
      return { moved, documents, sourceMembers };
    });
    await this.realtime.revokeStoryProjectAccess(projectId);
    await Promise.all(
      result.sourceMembers.map((member) =>
        this.documents.revokeUserFromDocuments(
          result.documents.map((document) => document.id),
          member.userId,
        ),
      ),
    );
    return {
      projectId: result.moved.id,
      workspaceId: result.moved.workspaceId,
      projectVersion: result.moved.version,
    };
  }

  private async assertIdle(tx: Prisma.TransactionClient, projectId: string) {
    const scope = { storyProjectId: projectId };
    const blockers = [
      await tx.aiJob.count({
        where: {
          ...scope,
          status: { in: ['created', 'in_queue', 'in_progress'] },
        },
      }),
      await tx.storyAgentRun.count({
        where: {
          ...scope,
          status: { notIn: ['succeeded', 'failed', 'cancelled', 'stale'] },
        },
      }),
      await tx.agentOsRun.count({
        where: {
          projectId,
          status: { notIn: ['completed', 'failed', 'cancelled'] },
        },
      }),
      await tx.storyGenerationBatch.count({
        where: {
          ...scope,
          status: {
            notIn: [
              'completed',
              'partial_failed',
              'cancelled',
              'failed',
              'expired',
            ],
          },
        },
      }),
      await tx.storyBuild.count({
        where: {
          ...scope,
          status: { in: ['queued', 'validating', 'compiling'] },
        },
      }),
      await tx.worldModelWorld.count({
        where: { ...scope, status: 'generating' },
      }),
      await tx.worldModelSession.count({
        where: { ...scope, status: 'active', expiresAt: { gt: new Date() } },
      }),
      await tx.worldModelTravel.count({
        where: { ...scope, status: { in: ['init', 'pending', 'running'] } },
      }),
      // A completed provider job may still be materializing canonical media.
      await tx.storyProductionGeneration.count({
        where: {
          ...scope,
          materializedAt: null,
          aiJob: { status: 'completed' },
        },
      }),
    ];
    if (blockers.some(Boolean)) {
      throw new ConflictException({
        code: 'STORY_PROJECT_BUSY',
        message:
          'Finish or cancel active generation, Agent, build and world sessions before moving this project.',
      });
    }
  }
}
