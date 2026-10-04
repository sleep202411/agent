import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProjectMemberRole, WorkspaceMemberRole } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { writeAdminAudit } from '../admin-auth/admin-audit';
import type { AdminActor } from '../admin-auth/admin-auth.types';
import { requireNonReceiptAsset } from '../media/media-receipt-policy';
import { AI_ACTOR_CATEGORIES, type AiActorCategory } from './ai-actors.types';

const photoWhere = {
  kind: 'image',
  status: 'ready',
  deletedAt: null,
  visibility: 'public',
  moderationStatus: { not: 'blocked' },
} satisfies Prisma.MediaAssetWhereInput;
const contentUrl = (id: string) => `/aurora/media/assets/${id}/content`;

@Injectable()
export class AiActorsService {
  constructor(
    private readonly db: PrismaService,
    private readonly permissions: WorkspacePermissionService,
  ) {}

  async list(userId: string, workspaceId: string, page: number) {
    await this.permissions.requireWorkspaceRole(
      userId,
      workspaceId,
      WorkspaceMemberRole.viewer,
    );
    const rows = await this.db.aiActor.findMany({
      where: { active: true, archivedAt: null, photo: photoWhere },
      include: { unlocks: { where: { workspaceId }, take: 1 } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * 24,
      take: 25,
    });
    return {
      items: rows.slice(0, 24).map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        photoUrl: contentUrl(r.photoAssetId),
        unlocked: r.unlocks.length > 0,
      })),
      hasMore: rows.length > 24,
    };
  }

  private async lockActor(tx: Prisma.TransactionClient, actorId: string) {
    await tx.$queryRaw`SELECT id FROM ai_actors WHERE id = ${actorId}::uuid FOR UPDATE`;
    const actor = await tx.aiActor.findUnique({ where: { id: actorId } });
    if (!actor || !actor.active || actor.archivedAt !== null)
      throw new NotFoundException('Actor is unavailable.');
    await tx.$queryRaw`SELECT id FROM media_assets WHERE id = ${actor.photoAssetId}::uuid FOR SHARE`;
    const photo = await tx.mediaAsset.findFirst({
      where: { id: actor.photoAssetId, ...photoWhere },
    });
    if (!photo) throw new NotFoundException('Actor photo is unavailable.');
    requireNonReceiptAsset(photo.metadata);
    return actor;
  }

  async unlock(userId: string, actorId: string, workspaceId: string) {
    return this.db.$transaction(async (tx) => {
      await this.lockActor(tx, actorId);
      await this.permissions.requireWorkspaceRole(
        userId,
        workspaceId,
        WorkspaceMemberRole.editor,
        tx,
      );
      return tx.aiActorUnlock.upsert({
        where: { actorId_workspaceId: { actorId, workspaceId } },
        create: { actorId, workspaceId, userId },
        update: {},
      });
    });
  }

  async use(
    userId: string,
    actorId: string,
    projectId: string,
    requestId: string,
  ) {
    return this.db.$transaction(async (tx) => {
      // Serialize retries (including mismatched actor IDs) before taking actor locks.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 0))::text`;
      const actor = await this.lockActor(tx, actorId);
      const project = await this.permissions.requireProjectRole(
        userId,
        projectId,
        ProjectMemberRole.editor,
        tx,
      );
      await this.permissions.requireWorkspaceRole(
        userId,
        project.workspaceId,
        WorkspaceMemberRole.viewer,
        tx,
      );
      if (
        !(await tx.aiActorUnlock.findUnique({
          where: {
            actorId_workspaceId: { actorId, workspaceId: project.workspaceId },
          },
        }))
      )
        throw new ConflictException(
          'Unlock this actor for the workspace first.',
        );
      const previous = await tx.aiActorUse.findUnique({
        where: { id: requestId },
      });
      if (
        previous &&
        (previous.userId !== userId ||
          previous.projectId !== projectId ||
          previous.actorId !== actorId)
      )
        throw new ConflictException(
          'This request identity has already been used.',
        );
      if (previous && previous.photoAssetId !== actor.photoAssetId)
        throw new ConflictException({
          code: 'AI_ACTOR_PHOTO_CHANGED',
          message: 'The actor photo changed. Start a new use.',
        });
      if (!previous)
        await tx.aiActorUse.create({
          data: {
            id: requestId,
            actorId,
            projectId,
            workspaceId: project.workspaceId,
            userId,
            photoAssetId: actor.photoAssetId,
          },
        });
      return {
        nodeId: requestId,
        actorId,
        name: actor.name,
        mediaAssetId: actor.photoAssetId,
        url: contentUrl(actor.photoAssetId),
      };
    });
  }

  async adminList(page: number, category?: AiActorCategory) {
    const where: Prisma.AiActorWhereInput = {
      archivedAt: null,
      ...(category ? { category } : {}),
    };
    const [total, items] = await this.db.$transaction([
      this.db.aiActor.count({ where }),
      this.db.aiActor.findMany({
        where,
        include: { _count: { select: { unlocks: true, uses: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 24,
        take: 24,
      }),
    ]);
    return {
      total,
      items: items.map((r) => ({
        ...r,
        category: r.category,
        photoUrl: contentUrl(r.photoAssetId),
      })),
    };
  }

  async archive(id: string) {
    return this.db.$transaction(async (tx) => {
      const actor = await tx.aiActor.findUnique({ where: { id } });
      if (!actor || actor.archivedAt !== null) {
        throw new NotFoundException('Actor not found.');
      }
      return tx.aiActor.update({
        where: { id },
        data: {
          archivedAt: new Date(),
          active: false,
        },
      });
    });
  }

  async save(
    admin: AdminActor,
    input: {
      id?: string;
      name: string;
      photoAssetId: string;
      active: boolean;
      category?: string;
    },
  ) {
    return this.db.$transaction(async (tx) => {
      if (input.id)
        await tx.$queryRaw`SELECT id FROM ai_actors WHERE id = ${input.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM media_assets WHERE id = ${input.photoAssetId}::uuid FOR SHARE`;
      const before = input.id
        ? await tx.aiActor.findUnique({ where: { id: input.id } })
        : null;
      if (input.id && (!before || before.archivedAt !== null))
        throw new NotFoundException('Actor not found.');
      const photo = await tx.mediaAsset.findFirst({
        where: { ...photoWhere, id: input.photoAssetId, visibility: undefined },
      });
      if (!photo)
        throw new BadRequestException('Choose a ready, public image.');
      requireNonReceiptAsset(photo.metadata);
      // A new photo must be an immutable verified upload owned by this admin.
      if (before?.photoAssetId !== input.photoAssetId) {
        const metadata =
          photo.metadata &&
          typeof photo.metadata === 'object' &&
          !Array.isArray(photo.metadata)
            ? photo.metadata
            : {};
        if (
          photo.createdByUserId !== admin.id ||
          metadata.uploadKind !== 'ai_reference_image' ||
          !photo.checksumSha256
        )
          throw new BadRequestException(
            'Upload and confirm an actor photo before saving.',
          );
      }
      await tx.mediaAsset.update({
        where: { id: photo.id },
        data: { visibility: 'public' },
      });
      const category = input.category ?? 'ai_actor';
      if (!AI_ACTOR_CATEGORIES.includes(category as AiActorCategory)) {
        throw new BadRequestException('Invalid actor category.');
      }
      const data = {
        name: input.name,
        photoAssetId: input.photoAssetId,
        active: input.active,
        category,
      };
      const actor = input.id
        ? await tx.aiActor.update({ where: { id: input.id }, data })
        : await tx.aiActor.create({ data });
      await writeAdminAudit(tx, {
        actor: admin,
        action: before ? 'ai_actor.update' : 'ai_actor.create',
        resourceType: 'ai_actor',
        resourceId: actor.id,
        metadata: {
          name: actor.name,
          active: actor.active,
          category: actor.category,
          photoAssetId: actor.photoAssetId,
        },
      });
      return actor;
    });
  }

  async usage(actorId: string, page: number) {
    const [total, items] = await this.db.$transaction([
      this.db.aiActorUse.count({ where: { actorId } }),
      this.db.aiActorUse.findMany({
        where: { actorId },
        include: {
          workspace: { select: { name: true } },
          project: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 24,
        take: 24,
      }),
    ]);
    return { total, items };
  }
}
