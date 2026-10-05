import { requireDisputeParticipants } from './dispute-participants';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MediaStorageProvider, Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../../auth';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../../admin-auth';
import { PrismaService } from '../../infra/db/db.module';
import {
  OutputStorageService,
  type CreateUploadUrlResult,
} from '../../infra/storage/storage.types';
import { StorageProviderRegistry } from '../../infra/storage/storage-provider-registry.service';
import { ensureOriginalMediaPlacement } from '../../infra/storage/media-asset-placement';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { CrewTaskDisputesService, type DisputeActor } from './task-disputes';

export const DisputeUpload = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (s) =>
          !/["/\\]/.test(s) &&
          [...s].every(
            (character) =>
              character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
      ),
    contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();
const Params = z.object({
  disputeId: z.string().uuid(),
  id: z.string().uuid(),
});
const Page = z
  .object({
    beforeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

@Injectable()
export class CrewDisputeAttachmentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly disputes: CrewTaskDisputesService,
    private readonly storage: OutputStorageService,
    private readonly registry: StorageProviderRegistry,
  ) {}
  private async lock(
    tx: Prisma.TransactionClient,
    disputeId: string,
    userId: string,
    draftTaskId?: string,
  ) {
    if (draftTaskId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:dispute-id:${disputeId}`},0))`;
      if (await tx.crewTaskDispute.findUnique({ where: { id: disputeId } }))
        throw new ConflictException('This case has already been submitted.');
      await requireDisputeParticipants(tx, draftTaskId, [userId]);
      return { id: disputeId };
    }
    await tx.$queryRaw`SELECT id FROM crew_task_disputes WHERE id=${disputeId}::uuid FOR UPDATE`;
    return this.disputes.attachmentAccess(
      disputeId,
      { kind: 'user', id: userId },
      tx,
    );
  }
  async issue(
    disputeId: string,
    id: string,
    userId: string,
    raw: z.infer<typeof DisputeUpload>,
    draftTaskId?: string,
  ) {
    const input = DisputeUpload.parse(raw);
    return this.db.$transaction(async (tx) => {
      // UUID identity locks also serialize accidental cross-case ID reuse.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:dispute-upload:${id}`},0))`;
      await this.lock(tx, disputeId, userId, draftTaskId);
      const scope = draftTaskId
        ? { disputeId: null, draftTaskId, draftDisputeId: disputeId }
        : { disputeId, draftTaskId: null, draftDisputeId: null };
      const old = await tx.crewDisputeAttachment.findUnique({ where: { id } });
      if (old) {
        if (
          old.disputeId !== scope.disputeId ||
          old.draftTaskId !== scope.draftTaskId ||
          old.draftDisputeId !== scope.draftDisputeId ||
          old.uploaderUserId !== userId ||
          old.name !== input.name ||
          old.contentType !== input.contentType ||
          old.sizeBytes !== input.sizeBytes
        )
          throw new ConflictException(
            'Upload identity was already used with different details.',
          );
        if (old.mediaAssetId)
          throw new ConflictException('This attachment is already confirmed.');
        const placement = old.placement as unknown as CreateUploadUrlResult;
        if (Date.parse(placement.expiresAt) <= Date.now())
          throw new ConflictException(
            'Upload expired. Start a new attachment upload.',
          );
        return placement;
      }
      // Resolved cases permit private preparation of evidence for an appeal.
      if (
        (await tx.crewDisputeAttachment.count({
          where: { ...scope, uploaderUserId: userId },
        })) >= 100
      )
        throw new ConflictException(
          'The attachment upload limit for this case has been reached.',
        );
      const placement = await this.storage.createPrivateUploadUrl({
        storageKey: `dispute-evidence/staging/${id}/${randomUUID()}`,
        contentType: input.contentType,
        maxBytes: input.sizeBytes,
        expiresInSeconds: 900,
      });
      await tx.crewDisputeAttachment.create({
        data: {
          id,
          ...scope,
          uploaderUserId: userId,
          ...input,
          placement: placement as unknown as Prisma.InputJsonValue,
          finalKey: `dispute-evidence/final/${randomUUID()}`,
        },
      });
      return placement;
    });
  }
  async confirm(
    disputeId: string,
    id: string,
    userId: string,
    draftTaskId?: string,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.lock(tx, disputeId, userId, draftTaskId);
        const scope = draftTaskId
          ? { disputeId: null, draftTaskId, draftDisputeId: disputeId }
          : { disputeId, draftTaskId: null, draftDisputeId: null };
        const attachment = await tx.crewDisputeAttachment.findFirst({
          where: { id, ...scope, uploaderUserId: userId },
        });
        if (!attachment) throw new NotFoundException('Attachment not found.');
        if (attachment.mediaAssetId) return { id };
        const placement =
          attachment.placement as unknown as CreateUploadUrlResult;
        const provider = this.registry.forProvider(
          placement.provider as MediaStorageProvider,
        );
        if (!provider)
          throw new BadRequestException('Evidence storage is unavailable.');
        const source = {
          bucket: placement.bucket,
          region: placement.region,
          storageKey: placement.storageKey,
        };
        const destination = { ...source, storageKey: attachment.finalKey };
        let head = await provider.headStoredObject(destination);
        if (!head.exists) {
          head = await provider.headStoredObject(source);
          if (
            !head.exists ||
            head.sizeBytes !== attachment.sizeBytes ||
            head.contentType !== attachment.contentType
          )
            throw new BadRequestException(
              'Uploaded evidence does not match the expected size and type.',
            );
          await provider.promoteObject({
            source,
            destination,
            expectedSizeBytes: attachment.sizeBytes,
            contentType: attachment.contentType,
            cacheControl: 'private, no-store',
          });
          head = await provider.headStoredObject(destination);
        }
        if (
          !head.exists ||
          head.sizeBytes !== attachment.sizeBytes ||
          head.contentType !== attachment.contentType
        )
          throw new BadRequestException('Evidence finalization is incomplete.');
        const asset = await tx.mediaAsset.create({
          data: {
            kind: attachment.contentType.startsWith('image/')
              ? 'image'
              : 'other',
            storageProvider: placement.provider as MediaStorageProvider,
            bucket: placement.bucket,
            region: placement.region,
            objectKey: attachment.finalKey,
            contentType: attachment.contentType,
            sizeBytes: BigInt(attachment.sizeBytes),
            visibility: 'private',
            status: 'ready',
            source: 'user_upload',
            createdByUserId: userId,
            metadata: { uploadKind: 'crew_dispute_evidence', disputeId },
          },
        });
        await ensureOriginalMediaPlacement(tx, {
          assetId: asset.id,
          ...asset,
          metadata: { uploadKind: 'crew_dispute_evidence', disputeId },
        });
        await tx.crewDisputeAttachment.update({
          where: { id },
          data: { mediaAssetId: asset.id },
        });
        return { id };
      },
      { timeout: 120000, maxWait: 10000 },
    );
  }
  private visible(disputeId: string, actor: DisputeActor) {
    return Prisma.sql`r.dispute_id=${disputeId}::uuid AND (
      ${actor.kind === 'user' ? Prisma.sql`r.uploader_user_id=${actor.id}` : Prisma.sql`FALSE`}
      OR EXISTS(SELECT 1 FROM crew_task_dispute_events e WHERE e.dispute_id=r.dispute_id AND r.id=ANY(e.attachment_ids)))`;
  }
  async list(
    disputeId: string,
    actor: DisputeActor,
    raw: z.infer<typeof Page> = { limit: 20 },
  ) {
    const page = Page.parse(raw);
    await this.disputes.attachmentAccess(disputeId, actor);
    const filter = this.visible(disputeId, actor);
    const [cursor] = page.beforeId
      ? await this.db.$queryRaw<{ id: string; createdAt: Date }[]>(
          Prisma.sql`SELECT r.id,r.created_at AS "createdAt" FROM crew_dispute_attachments r WHERE ${filter} AND r.id=${page.beforeId}::uuid`,
        )
      : [];
    if (page.beforeId && !cursor)
      throw new NotFoundException('Attachment cursor not found.');
    const rows = await this.db.$queryRaw<
      {
        id: string;
        name: string;
        contentType: string;
        sizeBytes: number;
        ready: boolean;
        shared: boolean;
        createdAt: Date;
      }[]
    >(Prisma.sql`
      SELECT r.id,r.name,r.content_type AS "contentType",r.size_bytes AS "sizeBytes",r.media_asset_id IS NOT NULL AS ready,r.created_at AS "createdAt",
        EXISTS(SELECT 1 FROM crew_task_dispute_events e WHERE e.dispute_id=r.dispute_id AND r.id=ANY(e.attachment_ids)) AS shared
      FROM crew_dispute_attachments r WHERE ${filter}
      ${cursor ? Prisma.sql`AND (r.created_at,r.id)<(${cursor.createdAt},${cursor.id}::uuid)` : Prisma.empty}
      ORDER BY r.created_at DESC,r.id DESC LIMIT ${page.limit + 1}`);
    return {
      items: rows.slice(0, page.limit),
      nextBeforeId: rows.length > page.limit ? rows[page.limit - 1].id : null,
    };
  }
  async read(disputeId: string, id: string, actor: DisputeActor) {
    await this.disputes.attachmentAccess(disputeId, actor);
    const [row] = await this.db.$queryRaw<
      { name: string; mediaAssetId: string }[]
    >(
      Prisma.sql`SELECT r.name,r.media_asset_id AS "mediaAssetId" FROM crew_dispute_attachments r WHERE r.id=${id}::uuid AND r.media_asset_id IS NOT NULL AND ${this.visible(disputeId, actor)}`,
    );
    if (!row) throw new NotFoundException('Attachment not found.');
    const asset = await this.db.mediaAsset.findFirst({
      where: {
        id: row.mediaAssetId,
        deletedAt: null,
        status: 'ready',
        moderationStatus: { not: 'blocked' },
      },
    });
    if (!asset || !asset.bucket || !asset.objectKey)
      throw new NotFoundException('Attachment is unavailable.');
    const provider = this.registry.forProvider(asset.storageProvider);
    if (!provider)
      throw new NotFoundException('Attachment storage is unavailable.');
    return provider.createReadUrl({
      bucket: asset.bucket,
      region: asset.region,
      storageKey: asset.objectKey,
      contentType: asset.contentType,
      filename: row.name,
      cacheControl: 'private, no-store',
      expiresInSeconds: 60,
    });
  }
}

@Controller('crew-disputes/:disputeId/attachments')
export class CrewDisputeAttachmentsController {
  constructor(private readonly svc: CrewDisputeAttachmentsService) {}
  @Post(':id')
  issue(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentUser() u: AuthUser,
    @Body(new ZodValidationPipe(DisputeUpload))
    input: z.infer<typeof DisputeUpload>,
  ) {
    return this.svc.issue(p.disputeId, p.id, u.userId, input);
  }
  @Post(':id/confirm')
  confirm(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.svc.confirm(p.disputeId, p.id, u.userId);
  }
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Param('disputeId', new ZodValidationPipe(z.string().uuid())) id: string,
    @CurrentUser() u: AuthUser,
    @Query(new ZodValidationPipe(Page)) page: z.infer<typeof Page>,
  ) {
    return this.svc.list(id, { kind: 'user', id: u.userId }, page);
  }
  @Get(':id/read')
  @Header('Cache-Control', 'private, no-store')
  read(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.svc.read(p.disputeId, p.id, { kind: 'user', id: u.userId });
  }
}
@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
@Controller('admin/crew-disputes/:disputeId/attachments')
export class CrewDisputeAttachmentsAdminController {
  constructor(private readonly svc: CrewDisputeAttachmentsService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Param('disputeId', new ZodValidationPipe(z.string().uuid())) id: string,
    @CurrentAdmin() admin: AdminActor,
    @Query(new ZodValidationPipe(Page)) page: z.infer<typeof Page>,
  ) {
    return this.svc.list(id, { kind: 'admin', admin }, page);
  }
  @Get(':id/read')
  @Header('Cache-Control', 'private, no-store')
  read(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentAdmin() admin: AdminActor,
  ) {
    return this.svc.read(p.disputeId, p.id, { kind: 'admin', admin });
  }
}

const DraftParams = z.object({
  taskId: z.string().uuid(),
  disputeId: z.string().uuid(),
  id: z.string().uuid(),
});
@Controller('crew-tasks/:taskId/dispute-drafts/:disputeId/attachments')
export class CrewDisputeDraftAttachmentsController {
  constructor(private readonly svc: CrewDisputeAttachmentsService) {}
  @Post(':id')
  issue(
    @Param(new ZodValidationPipe(DraftParams)) p: z.infer<typeof DraftParams>,
    @CurrentUser() u: AuthUser,
    @Body(new ZodValidationPipe(DisputeUpload))
    input: z.infer<typeof DisputeUpload>,
  ) {
    return this.svc.issue(p.disputeId, p.id, u.userId, input, p.taskId);
  }
  @Post(':id/confirm')
  confirm(
    @Param(new ZodValidationPipe(DraftParams)) p: z.infer<typeof DraftParams>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.svc.confirm(p.disputeId, p.id, u.userId, p.taskId);
  }
}
