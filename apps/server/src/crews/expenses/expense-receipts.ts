import { ensureOriginalMediaPlacement } from '../../infra/storage/media-asset-placement';
import { randomUUID } from 'node:crypto';
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
import { MediaStorageProvider, Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../../auth';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  RequireAdminPermissions,
} from '../../admin-auth';
import { PrismaService } from '../../infra/db/db.module';
import {
  OutputStorageService,
  type CreateUploadUrlResult,
} from '../../infra/storage/storage.types';
import { StorageProviderRegistry } from '../../infra/storage/storage-provider-registry.service';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { ZodValidationPipe } from '../../common/zod.pipe';
const paramsSchema = z.object({
  crewId: z.string().min(1).max(128),
  draftId: z.string().uuid(),
  id: z.string().uuid(),
});
export const ReceiptUpload = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((s) => !/[\r\n/\\]/.test(s)),
    contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();
type Receipt = {
  id: string;
  draft_id: string;
  claimant_user_id: string;
  name: string;
  content_type: string;
  size_bytes: number;
  placement: CreateUploadUrlResult;
  final_key: string;
  media_asset_id: string | null;
};
@Injectable()
export class CrewExpenseReceiptService {
  constructor(
    private readonly db: PrismaService,
    private readonly authz: CrewAuthorizationService,
    private readonly storage: OutputStorageService,
    private readonly registry: StorageProviderRegistry,
  ) {}
  private async lock(
    tx: Prisma.TransactionClient,
    draftId: string,
    crewId: string,
    userId: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:expense-draft:${draftId}`},0))`;
    await tx.$queryRaw`SELECT id FROM crews WHERE id=${crewId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM crew_members WHERE crew_id=${crewId} AND user_id=${userId} FOR SHARE`;
    await this.authz.requireMembership(crewId, userId, tx);
    const rows = await tx.$queryRaw<
      { version: number }[]
    >`SELECT version FROM crew_expense_draft_revisions WHERE id=${draftId}::uuid AND crew_id=${crewId} AND claimant_user_id=${userId} ORDER BY version DESC LIMIT 1`;
    if (!rows.length) throw new NotFoundException('Expense draft not found');
    return rows[0].version;
  }
  async issue(
    crewId: string,
    draftId: string,
    id: string,
    userId: string,
    input: z.infer<typeof ReceiptUpload>,
  ) {
    return this.db.$transaction(async (tx) => {
      const version = await this.lock(tx, draftId, crewId, userId);
      const [old] = await tx.$queryRaw<
        Receipt[]
      >`SELECT * FROM crew_expense_receipts WHERE id=${id}::uuid`;
      if (old) {
        if (
          old.draft_id !== draftId ||
          old.claimant_user_id !== userId ||
          old.name !== input.name ||
          old.content_type !== input.contentType ||
          old.size_bytes !== input.sizeBytes
        )
          throw new ConflictException('Receipt upload identity is unavailable');
        if (Date.parse(old.placement.expiresAt) <= Date.now())
          throw new ConflictException(
            'Receipt upload expired. Start a new upload.',
          );
        return old.placement;
      }
      const pending = await tx.$queryRaw<
        { draft_id: string }[]
      >`SELECT draft_id FROM crew_expense_submissions WHERE draft_id=${draftId}::uuid AND status='pending'`;
      if (pending.length)
        throw new ConflictException('This claim is awaiting review.');
      const placement = await this.storage.createPrivateUploadUrl({
        storageKey: `expense-receipts/staging/${id}/${randomUUID()}`,
        contentType: input.contentType,
        maxBytes: input.sizeBytes,
        expiresInSeconds: 900,
      });
      await tx.$executeRaw`INSERT INTO crew_expense_receipts(id,draft_id,draft_version,claimant_user_id,name,content_type,size_bytes,placement,final_key) VALUES(${id}::uuid,${draftId}::uuid,${version},${userId},${input.name},${input.contentType},${input.sizeBytes},${JSON.stringify(placement)}::jsonb,${`expense-receipts/final/${randomUUID()}`})`;
      await this.authz.requireMembership(crewId, userId, tx);
      return placement;
    });
  }
  async confirm(crewId: string, draftId: string, id: string, userId: string) {
    return this.db.$transaction(
      async (tx) => {
        await this.lock(tx, draftId, crewId, userId);
        const [receipt] = await tx.$queryRaw<
          Receipt[]
        >`SELECT * FROM crew_expense_receipts WHERE id=${id}::uuid AND draft_id=${draftId}::uuid AND claimant_user_id=${userId} FOR UPDATE`;
        if (!receipt) throw new NotFoundException('Receipt not found');
        if (receipt.media_asset_id) return { id };
        const location = receipt.placement;
        const provider = this.registry.forProvider(
          location.provider as MediaStorageProvider,
        );
        if (!provider)
          throw new BadRequestException('Receipt storage is unavailable');
        const source = {
          bucket: location.bucket,
          region: location.region,
          storageKey: location.storageKey,
        };
        const destination = { ...source, storageKey: receipt.final_key };
        // A completed copy survives a lost response or rolled-back DB transaction.
        let head = await provider.headStoredObject(destination);
        if (!head.exists) {
          head = await provider.headStoredObject(source);
          if (
            !head.exists ||
            head.sizeBytes !== receipt.size_bytes ||
            head.contentType !== receipt.content_type
          )
            throw new BadRequestException(
              'Receipt bytes do not match the upload',
            );
          await provider.promoteObject({
            source,
            destination,
            expectedSizeBytes: receipt.size_bytes,
            contentType: receipt.content_type,
            cacheControl: 'private, no-store',
          });
          head = await provider.headStoredObject(destination);
        }
        if (
          !head.exists ||
          head.sizeBytes !== receipt.size_bytes ||
          head.contentType !== receipt.content_type
        )
          throw new BadRequestException('Receipt finalization is incomplete');
        await this.authz.requireMembership(crewId, userId, tx);
        const asset = await tx.mediaAsset.create({
          data: {
            kind: 'other',
            storageProvider: location.provider as MediaStorageProvider,
            bucket: location.bucket,
            region: location.region,
            objectKey: receipt.final_key,
            contentType: receipt.content_type,
            sizeBytes: BigInt(receipt.size_bytes),
            visibility: 'private',
            status: 'ready',
            source: 'user_upload',
            createdByUserId: userId,
            metadata: { uploadKind: 'crew_expense_receipt', draftId },
          },
        });
        await ensureOriginalMediaPlacement(tx, {
          assetId: asset.id,
          ...asset,
          metadata: { uploadKind: 'crew_expense_receipt', draftId },
        });
        await tx.$executeRaw`UPDATE crew_expense_receipts SET media_asset_id=${asset.id}::uuid WHERE id=${id}::uuid`;
        return { id };
      },
      { timeout: 120000, maxWait: 10000 },
    );
  }
  async list(crewId: string, draftId: string, userId: string, after?: string) {
    const rows = await this.db.$queryRaw<{ id: string; name: string }[]>(
      Prisma.sql`SELECT r.id,r.name FROM crew_expense_receipts r WHERE r.draft_id=${draftId}::uuid AND r.claimant_user_id=${userId} AND r.media_asset_id IS NOT NULL AND ${after ? Prisma.sql`r.id > ${after}::uuid` : Prisma.sql`TRUE`} AND EXISTS(SELECT 1 FROM crew_expense_draft_revisions d WHERE d.id=r.draft_id AND d.crew_id=${crewId} AND d.claimant_user_id=${userId}) ORDER BY r.id LIMIT 31`,
    );
    return {
      items: rows.slice(0, 30),
      nextCursor: rows.length > 30 ? rows[29].id : null,
    };
  }
  async read(
    draftId: string,
    id: string,
    scope: { userId: string; crewId: string } | { submittedVersion: number },
  ) {
    const [receipt] = await this.db.$queryRaw<Receipt[]>(Prisma.sql`
   SELECT r.* FROM crew_expense_receipts r WHERE r.id=${id}::uuid AND r.draft_id=${draftId}::uuid AND r.media_asset_id IS NOT NULL
   AND EXISTS(SELECT 1 FROM crew_expense_draft_revisions d WHERE d.id=r.draft_id AND ${'userId' in scope ? Prisma.sql`d.claimant_user_id=${scope.userId} AND d.crew_id=${scope.crewId} AND r.claimant_user_id=${scope.userId}` : Prisma.sql`d.version=${scope.submittedVersion} AND COALESCE(d.definition->'receiptIds','[]'::jsonb) @> ${JSON.stringify([id])}::jsonb AND EXISTS(SELECT 1 FROM crew_expense_submissions s WHERE s.draft_id=d.id AND s.draft_version=d.version)`})`);
    if (!receipt) throw new NotFoundException('Receipt not found');
    const asset = await this.db.mediaAsset.findFirst({
      where: {
        id: receipt.media_asset_id!,
        deletedAt: null,
        status: 'ready',
        moderationStatus: { not: 'blocked' },
      },
    });
    if (!asset) throw new NotFoundException('Receipt is unavailable');
    const provider = this.registry.forProvider(asset.storageProvider);
    if (!provider || !asset.bucket || !asset.objectKey)
      throw new NotFoundException('Receipt is unavailable');
    return provider.createReadUrl({
      bucket: asset.bucket,
      region: asset.region,
      storageKey: asset.objectKey,
      contentType: asset.contentType,
      filename: receipt.name,
      cacheControl: 'private, no-store',
      expiresInSeconds: 60,
    });
  }
}
@Controller('crews/:crewId/expense-drafts/:draftId/receipts')
export class CrewExpenseReceiptController {
  constructor(private readonly service: CrewExpenseReceiptService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Param(new ZodValidationPipe(paramsSchema.omit({ id: true })))
    p: { crewId: string; draftId: string },
    @CurrentUser() u: AuthUser,
    @Query(
      new ZodValidationPipe(
        z.object({ after: z.string().uuid().optional() }).strict(),
      ),
    )
    q: { after?: string },
  ) {
    return this.service.list(p.crewId, p.draftId, u.userId, q.after);
  }
  @Post(':id') issue(
    @Param(new ZodValidationPipe(paramsSchema)) p: z.infer<typeof paramsSchema>,
    @CurrentUser() u: AuthUser,
    @Body(new ZodValidationPipe(ReceiptUpload))
    body: z.infer<typeof ReceiptUpload>,
  ) {
    return this.service.issue(p.crewId, p.draftId, p.id, u.userId, body);
  }
  @Post(':id/confirm') confirm(
    @Param(new ZodValidationPipe(paramsSchema)) p: z.infer<typeof paramsSchema>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.confirm(p.crewId, p.draftId, p.id, u.userId);
  }
  @Get(':id/read') @Header('Cache-Control', 'private, no-store') read(
    @Param(new ZodValidationPipe(paramsSchema)) p: z.infer<typeof paramsSchema>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.read(p.draftId, p.id, {
      userId: u.userId,
      crewId: p.crewId,
    });
  }
}
@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/crew-expense-submissions/:draftId/receipts')
export class CrewExpenseReceiptAdminController {
  constructor(private readonly service: CrewExpenseReceiptService) {}
  @Get(':id/read')
  @Header('Cache-Control', 'private, no-store')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  read(
    @Param(new ZodValidationPipe(paramsSchema.omit({ crewId: true })))
    p: { draftId: string; id: string },
    @Query(
      new ZodValidationPipe(
        z.object({ version: z.coerce.number().int().positive() }).strict(),
      ),
    )
    q: { version: number },
  ) {
    return this.service.read(p.draftId, p.id, { submittedVersion: q.version });
  }
}

export async function requireExpenseReceipts(
  tx: Prisma.TransactionClient,
  draftId: string,
  userId: string,
  ids: readonly string[] | undefined,
) {
  if (!ids?.length) return;
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT r.id FROM crew_expense_receipts r JOIN media_assets a ON a.id=r.media_asset_id WHERE r.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) AND r.draft_id=${draftId}::uuid AND r.claimant_user_id=${userId} AND a.status='ready' AND a.deleted_at IS NULL AND a.moderation_status <> 'blocked' FOR SHARE OF r,a`,
  );
  if (rows.length !== ids.length)
    throw new BadRequestException(
      'One or more receipts are unavailable for this claim',
    );
}
