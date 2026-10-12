import {
  revenueContractFileType,
  REVENUE_CONTRACT_MAX_BYTES,
} from './revenue-contract-file';
export { REVENUE_CONTRACT_MAX_BYTES };
import { createHash, randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CrewRevenueContract, MediaStorageProvider } from '@prisma/client';
import type { AdminActor } from '../admin-auth';
import { PrismaService } from '../infra/db/db.module';
import { StorageProviderRegistry } from '../infra/storage/storage-provider-registry.service';
import { crewAssetStorageProviderForCell } from '../infra/storage/crew-asset-storage-policy';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { CURRENT_CELL } from '../common/region/current-cell';
import { lockLedgerReceipt } from '../crews/earnings/ledger-lock';
import { requireRevenueAdmin } from './revenue-admin-access';

export interface RevenueContractFile {
  buffer: Buffer;
  originalname: string;
}

@Injectable()
export class RevenueContractsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private draining: Promise<void> | null = null;
  private stopped = false;
  private readonly logger = new Logger(RevenueContractsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageRegistry: StorageProviderRegistry,
  ) {}

  onApplicationBootstrap() {
    if (this.stopped || this.timer || !backgroundTasksEnabled()) return;
    const run = () => {
      void this.drainCleanup().catch(() =>
        this.logger.error('Revenue contract cleanup sweep failed.'),
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
      { object_key: string }[]
    >`SELECT object_key FROM crew_revenue_contract_uploads WHERE next_attempt_at<=now() ORDER BY next_attempt_at,object_key LIMIT 50`;
    for (const row of rows) {
      if (this.stopped || !backgroundTasksEnabled()) break;
      try {
        await this.cleanupObject(row.object_key);
      } catch {
        this.logger.error('Revenue contract cleanup retained for retry.');
      }
    }
  }
  /** Retire under the same lock as evidence publication, then delete outside
   * the transaction. A delayed delete can never race a new reference write. */
  async cleanupObject(key: string, immediate = false) {
    const claim = await this.prisma.$transaction(async (tx) => {
      await lockLedgerReceipt(tx, `revenue-contract-object:${key}`);
      const [row] = await tx.$queryRaw<
        {
          provider: MediaStorageProvider;
          bucket: string;
          region: string | null;
          due: boolean;
        }[]
      >`SELECT provider,bucket,region,next_attempt_at<=now() AS due FROM crew_revenue_contract_uploads WHERE object_key=${key}`;
      if (!row || (!immediate && !row.due)) return null;
      const referenced = await tx.crewRevenueContract.findFirst({
        where: {
          objectKey: key,
          bucket: row.bucket,
          storageProvider: row.provider,
        },
        select: { id: true },
      });
      if (referenced) {
        await tx.$executeRaw`DELETE FROM crew_revenue_contract_uploads WHERE object_key=${key}`;
        return null;
      }
      await tx.$executeRaw`UPDATE crew_revenue_contract_uploads SET status='retired',next_attempt_at=now()+interval '15 minutes' WHERE object_key=${key}`;
      return row;
    });
    if (!claim) return;
    const storage = this.storageRegistry.forProvider(claim.provider);
    if (!storage)
      throw new ServiceUnavailableException(
        'Contract cleanup storage is unavailable.',
      );
    await storage.deleteObject({
      bucket: claim.bucket,
      storageKey: key,
      region: claim.region,
    });
    await this.prisma
      .$executeRaw`DELETE FROM crew_revenue_contract_uploads WHERE object_key=${key} AND status='retired'`;
  }

  async upload(admin: AdminActor, crewId: string, file?: RevenueContractFile) {
    requireRevenueAdmin(admin);
    const type = revenueContractFileType(file?.buffer);
    const bytes = file!.buffer;
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { id: true },
    });
    if (!crew) throw new NotFoundException('Crew not found.');
    const checksumSha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = await this.prisma.crewRevenueContract.findUnique({
      where: { crewId_checksumSha256: { crewId, checksumSha256 } },
    });
    if (existing) return contractDto(existing);
    const storage = this.storageRegistry.forProvider(
      crewAssetStorageProviderForCell(CURRENT_CELL),
    );
    if (!storage)
      throw new ServiceUnavailableException(
        'Private contract storage is unavailable.',
      );
    const key = `crew-revenue-contracts/${randomUUID()}.${type.extension}`;
    const placement = await storage.createPrivateUploadUrl({
      storageKey: key,
      contentType: type.contentType,
      maxBytes: bytes.length,
      expiresInSeconds: 120,
    });
    if (placement.storageKey !== key || !placement.bucket)
      throw new ServiceUnavailableException(
        'Private contract upload destination is invalid.',
      );
    // Record recovery before sending bytes. A crash must not leave an undiscoverable object.
    await this.prisma
      .$executeRaw`INSERT INTO crew_revenue_contract_uploads(object_key,provider,bucket,region) VALUES(${key},${placement.provider}::"MediaStorageProvider",${placement.bucket},${placement.region ?? null})`;
    let persisted = false;
    try {
      // The signed write URL stays server-side. The browser never obtains a
      // capability to overwrite the verified contract after confirmation.
      const response = await fetch(placement.url, {
        method: 'PUT',
        headers: { ...placement.headers, 'content-type': type.contentType },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
      await response.body?.cancel();
      if (!response.ok)
        throw new ServiceUnavailableException(
          'Private contract upload failed.',
        );
      const ref = {
        bucket: placement.bucket,
        storageKey: key,
        region: placement.region,
      };
      const stored = await storage.headStoredObject(ref);
      if (
        !stored.exists ||
        stored.sizeBytes !== bytes.length ||
        stored.contentType?.split(';')[0] !== type.contentType
      )
        throw new ServiceUnavailableException(
          'The uploaded contract could not be verified.',
        );
      const result = await this.prisma.$transaction(async (tx) => {
        await lockLedgerReceipt(tx, `revenue-contract-object:${key}`);
        const [pending] = await tx.$queryRaw<
          { status: string }[]
        >`SELECT status FROM crew_revenue_contract_uploads WHERE object_key=${key}`;
        if (pending?.status !== 'pending')
          throw new ServiceUnavailableException(
            'Contract upload expired. Upload the document again.',
          );
        await lockLedgerReceipt(
          tx,
          `revenue-contract-file:${crewId}:${checksumSha256}`,
        );
        const duplicate = await tx.crewRevenueContract.findUnique({
          where: { crewId_checksumSha256: { crewId, checksumSha256 } },
        });
        if (duplicate) return duplicate;
        const row = await tx.crewRevenueContract.create({
          data: {
            crewId,
            checksumSha256,
            filename: safeFilename(file!.originalname, type.extension),
            contentType: type.contentType,
            storageProvider: placement.provider,
            bucket: placement.bucket,
            region: placement.region,
            objectKey: key,
            sizeBytes: BigInt(bytes.length),
            uploadedByAdminId: admin.id,
            verifiedAt: new Date(),
          },
        });
        await tx.adminAuditLog.create({
          data: {
            actorUserId: admin.id,
            actorSessionId: admin.sessionId,
            siteScope: admin.siteScope,
            action: 'creator.revenue.contract.uploaded',
            resourceType: 'crew_revenue_contract',
            resourceId: row.id,
            metadata: { crewId, sizeBytes: bytes.length, checksumSha256 },
          },
        });
        await tx.$executeRaw`DELETE FROM crew_revenue_contract_uploads WHERE object_key=${key}`;
        return row;
      });
      persisted = result.objectKey === key;
      return contractDto(result);
    } finally {
      if (!persisted) {
        try {
          // Shared object lock resolves any ambiguous commit before retirement.
          await this.cleanupObject(key, true);
        } catch {
          this.logger.error(
            `Unreferenced revenue contract cleanup required: ${key}`,
          );
        }
      }
    }
  }

  async download(admin: AdminActor, id: string) {
    requireRevenueAdmin(admin);
    const row = await this.prisma.crewRevenueContract.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Contract not found.');
    const storage = this.storageRegistry.forProvider(row.storageProvider);
    if (!storage)
      throw new ServiceUnavailableException('Contract storage is unavailable.');
    const link = await storage.createReadUrl({
      bucket: row.bucket,
      storageKey: row.objectKey,
      region: row.region,
      filename: row.filename,
      contentType: row.contentType,
      cacheControl: 'private, no-store',
      expiresInSeconds: 60,
    });
    await this.prisma.adminAuditLog.create({
      data: {
        actorUserId: admin.id,
        actorSessionId: admin.sessionId,
        siteScope: admin.siteScope,
        action: 'creator.revenue.contract.read',
        resourceType: 'crew_revenue_contract',
        resourceId: row.id,
      },
    });
    return { url: link.url, expiresAt: link.expiresAt };
  }
}

function safeFilename(input: string, extension: string) {
  const sanitized = Array.from(input)
    .filter(
      (char) =>
        char.charCodeAt(0) >= 32 &&
        char.charCodeAt(0) !== 127 &&
        !'";'.includes(char),
    )
    .join('');
  const stem =
    sanitized.replaceAll('\\', '/').split('/').at(-1)?.slice(0, 240) ||
    `contract.${extension}`;
  return stem.toLowerCase().endsWith(`.${extension}`)
    ? stem
    : `${stem}.${extension}`;
}
function contractDto(row: CrewRevenueContract) {
  return {
    id: row.id,
    crewId: row.crewId,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes.toString(),
    verifiedAt: row.verifiedAt.toISOString(),
  };
}
