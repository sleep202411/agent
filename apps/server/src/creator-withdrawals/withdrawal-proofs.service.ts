import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { MediaStorageProvider, Prisma } from '@prisma/client';
import type { AdminActor } from '../admin-auth';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { CURRENT_CELL } from '../common/region/current-cell';
import { PrismaService } from '../infra/db/db.module';
import { crewAssetStorageProviderForCell } from '../infra/storage/crew-asset-storage-policy';
import { StorageProviderRegistry } from '../infra/storage/storage-provider-registry.service';
import { revenueContractFileType } from './revenue-contract-file';
import { WithdrawalAdminService } from './withdrawal-admin.service';

type Proof = {
  id: string;
  withdrawal_id: string;
  filename: string;
  content_type: string;
  size_bytes: bigint;
  provider: MediaStorageProvider;
  bucket: string;
  region: string | null;
  object_key: string;
  status: string;
  due: boolean;
};

@Injectable()
export class WithdrawalProofsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private draining: Promise<void> | null = null;
  private stopped = false;
  private readonly logger = new Logger(WithdrawalProofsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: StorageProviderRegistry,
    private readonly withdrawals: WithdrawalAdminService,
  ) {}

  onApplicationBootstrap() {
    if (this.stopped || this.timer || !backgroundTasksEnabled()) return;
    const run = () => {
      void this.drainCleanup().catch(() =>
        this.logger.error('Withdrawal proof cleanup failed.'),
      );
    };
    this.timer = setInterval(run, 60000);
    this.timer.unref();
    run();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.draining?.catch(() => undefined);
  }
  async drainCleanup() {
    if (this.stopped || !backgroundTasksEnabled()) return;
    if (this.draining) return this.draining;
    this.draining = this.sweep().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }
  private async sweep() {
    const rows = await this.prisma.$queryRaw<
      { id: string }[]
    >`SELECT id FROM creator_withdrawal_proofs WHERE next_attempt_at<=now() ORDER BY next_attempt_at,id LIMIT 50`;
    for (const row of rows) {
      if (this.stopped || !backgroundTasksEnabled()) break;
      try {
        await this.cleanup(row.id);
      } catch {
        this.logger.error('Withdrawal proof retained for cleanup retry.');
      }
    }
  }
  private async lockWithdrawal(tx: Prisma.TransactionClient, id: string) {
    const identity = await tx.creatorWithdrawal.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!identity) throw new NotFoundException('Withdrawal not found.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`creator-withdrawal:${identity.userId}`},0))`;
    const row = await tx.creatorWithdrawal.findUniqueOrThrow({ where: { id } });
    return row;
  }
  private async requireClaim(
    tx: Prisma.TransactionClient,
    admin: AdminActor,
    id: string,
  ) {
    this.withdrawals.assertAccess(admin);
    const row = await this.lockWithdrawal(tx, id);
    if (row.status !== 'processing' || row.processingAdminId !== admin.id)
      throw new ConflictException(
        'You must hold the processing claim to upload payment proof.',
      );
    return row;
  }
  async upload(
    admin: AdminActor,
    withdrawalId: string,
    file?: { buffer: Buffer; originalname: string },
  ) {
    this.withdrawals.assertAccess(admin);
    let type: ReturnType<typeof revenueContractFileType>;
    try {
      type = revenueContractFileType(file?.buffer);
    } catch {
      throw new BadRequestException(
        'Upload a PDF, JPG or PNG payment proof up to 10 MB.',
      );
    }
    const bytes = file!.buffer;
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const duplicate = await this.prisma.$transaction(async (tx) => {
      await this.requireClaim(tx, admin, withdrawalId);
      const [row] = await tx.$queryRaw<
        Proof[]
      >`SELECT * FROM creator_withdrawal_proofs WHERE withdrawal_id=${withdrawalId}::uuid AND checksum_sha256=${checksum} AND status='ready' ORDER BY created_at LIMIT 1 FOR UPDATE`;
      if (row)
        await tx.$executeRaw`UPDATE creator_withdrawal_proofs SET next_attempt_at=now()+interval '24 hours' WHERE id=${row.id}::uuid`;
      return row;
    });
    if (duplicate) return proofDto(duplicate);
    const storage = this.registry.forProvider(
      crewAssetStorageProviderForCell(CURRENT_CELL),
    );
    if (!storage)
      throw new ServiceUnavailableException(
        'Private payment proof storage is unavailable.',
      );
    const id = randomUUID();
    const key = `withdrawal-proofs/${id}.${type.extension}`;
    const placement = await storage.createPrivateUploadUrl({
      storageKey: key,
      contentType: type.contentType,
      maxBytes: bytes.length,
      expiresInSeconds: 120,
    });
    if (placement.storageKey !== key || !placement.bucket)
      throw new ServiceUnavailableException(
        'Invalid payment proof storage destination.',
      );
    const filename = proofFilename(file!.originalname, type.extension);
    await this.prisma.$transaction(async (tx) => {
      await this.requireClaim(tx, admin, withdrawalId);
      await tx.$executeRaw`INSERT INTO creator_withdrawal_proofs(id,withdrawal_id,uploaded_by_admin_id,checksum_sha256,filename,content_type,size_bytes,provider,bucket,region,object_key) VALUES(${id}::uuid,${withdrawalId}::uuid,${admin.id},${checksum},${filename},${type.contentType},${BigInt(bytes.length)},${placement.provider}::"MediaStorageProvider",${placement.bucket},${placement.region ?? null},${key})`;
    });
    // Persist recovery before PUT; an ambiguous network failure may still write.
    // The 24-hour cleanup grace exceeds the two-minute signed write capability.
    const response = await fetch(placement.url, {
      method: 'PUT',
      headers: { ...placement.headers, 'content-type': type.contentType },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    await response.body?.cancel();
    if (!response.ok)
      throw new ServiceUnavailableException('Payment proof upload failed.');
    const stored = await storage.headStoredObject({
      bucket: placement.bucket,
      storageKey: key,
      region: placement.region,
    });
    if (
      !stored.exists ||
      stored.sizeBytes !== bytes.length ||
      stored.contentType?.split(';')[0] !== type.contentType
    )
      throw new ServiceUnavailableException(
        'The uploaded payment proof could not be verified.',
      );
    return this.prisma.$transaction(async (tx) => {
      await this.requireClaim(tx, admin, withdrawalId);
      const rows = await tx.$queryRaw<
        Proof[]
      >`UPDATE creator_withdrawal_proofs SET status='ready',verified_at=now() WHERE id=${id}::uuid AND status='uploading' RETURNING *`;
      if (!rows[0])
        throw new ConflictException(
          'Payment proof upload expired. Upload the file again.',
        );
      await tx.adminAuditLog.create({
        data: {
          actorUserId: admin.id,
          actorSessionId: admin.sessionId,
          siteScope: admin.siteScope,
          action: 'creator.withdrawal.proof.uploaded',
          resourceType: 'creator_withdrawal',
          resourceId: withdrawalId,
          metadata: {
            proofId: id,
            sizeBytes: bytes.length,
            checksumSha256: checksum,
          },
        },
      });
      return proofDto(rows[0]);
    });
  }
  async downloadForCreator(userId: string, withdrawalId: string) {
    // A paid proof link is immutable. Scope the lookup to the authenticated
    // recipient before issuing any private storage capability.
    const [row] = await this.prisma.$queryRaw<Proof[]>`
      SELECT p.* FROM creator_withdrawal_proofs p
      JOIN creator_withdrawals w ON w.payment_proof_id=p.id AND p.withdrawal_id=w.id
      WHERE w.id=${withdrawalId}::uuid AND w.user_id=${userId}
        AND w.status='paid' AND p.status='ready'`;
    if (!row) throw new NotFoundException('Payment proof not found.');
    const storage = this.registry.forProvider(row.provider);
    if (!storage)
      throw new ServiceUnavailableException(
        'Payment proof storage is unavailable.',
      );
    const link = await storage.createReadUrl({
      bucket: row.bucket,
      storageKey: row.object_key,
      region: row.region,
      filename: row.filename,
      contentType: row.content_type,
      cacheControl: 'private, no-store',
      expiresInSeconds: 60,
    });
    return { url: link.url, expiresAt: link.expiresAt };
  }
  async download(admin: AdminActor, withdrawalId: string, id: string) {
    this.withdrawals.assertAccess(admin);
    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await this.lockWithdrawal(tx, withdrawalId);
      const [row] = await tx.$queryRaw<
        Proof[]
      >`SELECT * FROM creator_withdrawal_proofs WHERE id=${id}::uuid AND withdrawal_id=${withdrawalId}::uuid AND status='ready' FOR SHARE`;
      if (
        !row ||
        (withdrawal.paymentProofId !== id &&
          (withdrawal.status !== 'processing' ||
            withdrawal.processingAdminId !== admin.id))
      )
        throw new NotFoundException('Payment proof not found.');
      const storage = this.registry.forProvider(row.provider);
      if (!storage)
        throw new ServiceUnavailableException(
          'Payment proof storage is unavailable.',
        );
      const link = await storage.createReadUrl({
        bucket: row.bucket,
        storageKey: row.object_key,
        region: row.region,
        filename: row.filename,
        contentType: row.content_type,
        cacheControl: 'private, no-store',
        expiresInSeconds: 60,
      });
      await tx.adminAuditLog.create({
        data: {
          actorUserId: admin.id,
          actorSessionId: admin.sessionId,
          siteScope: admin.siteScope,
          action: 'creator.withdrawal.proof.read',
          resourceType: 'creator_withdrawal',
          resourceId: withdrawalId,
          metadata: { proofId: id },
        },
      });
      return { url: link.url, expiresAt: link.expiresAt };
    });
  }
  async cleanup(id: string) {
    const identity = await this.prisma.$queryRaw<
      { withdrawal_id: string }[]
    >`SELECT withdrawal_id FROM creator_withdrawal_proofs WHERE id=${id}::uuid`;
    if (!identity[0]) return;
    const claim = await this.prisma.$transaction(async (tx) => {
      const withdrawal = await this.lockWithdrawal(
        tx,
        identity[0].withdrawal_id,
      );
      const [row] = await tx.$queryRaw<
        Proof[]
      >`SELECT *,next_attempt_at<=now() AS due FROM creator_withdrawal_proofs WHERE id=${id}::uuid FOR UPDATE`;
      if (!row || !row.due) return null;
      if (withdrawal.paymentProofId === id) {
        await tx.$executeRaw`UPDATE creator_withdrawal_proofs SET next_attempt_at=NULL WHERE id=${id}::uuid`;
        return null;
      }
      await tx.$executeRaw`UPDATE creator_withdrawal_proofs SET status='retired',next_attempt_at=now()+interval '15 minutes' WHERE id=${id}::uuid`;
      return row;
    });
    if (!claim) return;
    const storage = this.registry.forProvider(claim.provider);
    if (!storage)
      throw new ServiceUnavailableException(
        'Payment proof cleanup storage is unavailable.',
      );
    await storage.deleteObject({
      bucket: claim.bucket,
      storageKey: claim.object_key,
      region: claim.region,
    });
    await this.prisma
      .$executeRaw`DELETE FROM creator_withdrawal_proofs WHERE id=${id}::uuid AND status='retired'`;
  }
}
function proofDto(row: Proof) {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
  };
}
function proofFilename(input: string, extension: string) {
  const clean =
    Array.from(input)
      .filter(
        (char) =>
          char.charCodeAt(0) >= 32 &&
          char.charCodeAt(0) !== 127 &&
          !'";'.includes(char),
      )
      .join('')
      .replaceAll('\\', '/')
      .split('/')
      .at(-1) || 'payment-proof';
  return `${clean.replace(/\.[^.]*$/, '').slice(0, 220)}.${extension}`;
}
