import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  CrewAgreementArchiveJobStatus,
  CrewAgreementStatus,
  CrewAssetAccessMode,
  CrewAssetNodeKind,
  CrewAssetPermission,
  MediaAssetKind,
  MediaAssetSource,
  MediaAssetStatus,
  MediaAssetVisibility,
  MediaStorageProvider,
  Prisma,
} from '@prisma/client';
import { CURRENT_CELL } from '../../common/region/current-cell';
import { PrismaService } from '../../infra/db/db.module';
import { ensureOriginalMediaPlacement } from '../../infra/storage/media-asset-placement';
import { crewAssetStorageProviderForCell } from '../../infra/storage/crew-asset-storage-policy';
import { StorageProviderRegistry } from '../../infra/storage/storage-provider-registry.service';
import type {
  OutputStorageResult,
  OutputStorageService,
} from '../../infra/storage/storage.types';
import { availableCrewAssetName } from '../assets/asset-name';
import { lockCrewAssetFolderNames } from '../assets/upload-lock';
import {
  BoldSignAgreementProvider,
  type BoldSignPdfArtifact,
} from './boldsign-agreement.provider';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_BATCH_SIZE = 10;
const LOCK_TTL_MS = 2 * 60 * 1_000;
const MAX_ATTEMPTS = 12;
const BACKOFFS_MS = [
  2_000,
  10_000,
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
];
const WORKER_ID = `${hostname()}-${process.pid}`;

type ClaimedArchiveJob = Prisma.CrewAgreementArchiveJobGetPayload<{
  include: { agreement: true };
}>;

type ArtifactKind = 'signed_document' | 'audit_trail';

@Injectable()
export class CrewAgreementArchiveWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CrewAgreementArchiveWorker.name);
  private readonly pollIntervalMs = positiveIntegerEnv(
    'CREW_AGREEMENT_ARCHIVE_POLL_MS',
    DEFAULT_POLL_INTERVAL_MS,
  );
  private readonly batchSize = positiveIntegerEnv(
    'CREW_AGREEMENT_ARCHIVE_BATCH_SIZE',
    DEFAULT_BATCH_SIZE,
  );
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: BoldSignAgreementProvider,
    private readonly storageRegistry: StorageProviderRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (this.stopped) return;
    if (!this.provider.isEnabled()) {
      this.logger.log('Crew agreement archive worker disabled');
      return;
    }
    this.timer = setInterval(() => void this.drainOnce(), this.pollIntervalMs);
    this.timer.unref?.();
    void this.drainOnce();
    this.logger.log(
      `Crew agreement archive worker running every ${this.pollIntervalMs}ms (worker=${WORKER_ID})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.draining;
  }

  /** Public for deterministic operational checks and focused tests. */
  async drainOnce(): Promise<void> {
    if (this.stopped) return;
    if (this.draining) return this.draining;
    this.draining = this.drain().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(): Promise<void> {
    try {
      for (let archived = 0; archived < this.batchSize; archived += 1) {
        if (this.stopped) return;
        // Downloading and storing one agreement must not age queued leases.
        const [job] = await this.claim(1);
        // A database claim may complete after shutdown begins. Its lease can
        // expire for another worker; do not start new provider/storage I/O.
        if (!job || this.stopped) break;
        await this.archiveOne(job);
      }
    } catch (error) {
      this.logger.error(
        `crew agreement archive drain failed: ${errorMessage(error)}`,
      );
    }
  }

  private async claim(batch: number): Promise<ClaimedArchiveJob[]> {
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - LOCK_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const eligible = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM crew_agreement_archive_jobs
        WHERE (
          status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
          AND (locked_at IS NULL OR locked_at < ${lockExpiry})
        ) OR (
          status = 'processing'
          AND locked_at < ${lockExpiry}
        )
        ORDER BY created_at ASC
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED
      `);
      if (eligible.length === 0) return [];

      const ids = eligible.map((row) => row.id);
      await tx.crewAgreementArchiveJob.updateMany({
        where: { id: { in: ids } },
        data: {
          status: CrewAgreementArchiveJobStatus.processing,
          lockedAt: now,
          lockedBy: WORKER_ID,
        },
      });
      return tx.crewAgreementArchiveJob.findMany({
        where: {
          id: { in: ids },
          status: CrewAgreementArchiveJobStatus.processing,
          lockedAt: now,
          lockedBy: WORKER_ID,
        },
        include: { agreement: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  private async archiveOne(job: ClaimedArchiveJob): Promise<void> {
    try {
      if (job.agreement.status !== CrewAgreementStatus.signed) {
        throw new Error(
          `Agreement ${job.agreementId} is not signed and cannot be archived`,
        );
      }
      const documentId = job.agreement.providerDocumentId;
      if (!documentId) {
        throw new Error(
          `Agreement ${job.agreementId} has no BoldSign document id`,
        );
      }
      if (job.agreement.assetNodeId && job.agreement.auditAssetNodeId) {
        await this.acknowledgeExistingArchive(job);
        return;
      }

      const storage = this.archiveStorage();
      const signed = await this.downloadAndStore(
        job,
        'signed_document',
        () => this.provider.downloadSignedDocument(documentId),
        storage,
      );
      const audit = await this.downloadAndStore(
        job,
        'audit_trail',
        () => this.provider.downloadAuditTrail(documentId),
        storage,
      );
      await this.persistArchive(job, signed, audit);
      this.logger.log(
        `Archived signed agreement artifacts agreement=${job.agreementId}`,
      );
    } catch (error) {
      await this.recordFailure(job, error);
    }
  }

  private archiveStorage(): OutputStorageService {
    const provider = crewAssetStorageProviderForCell(CURRENT_CELL);
    const storage = this.storageRegistry.forProvider(provider);
    if (!storage) {
      throw new ServiceUnavailableException({
        message: `Crew agreement archive storage provider "${provider}" is unavailable.`,
      });
    }
    return storage;
  }

  private async downloadAndStore(
    job: ClaimedArchiveJob,
    kind: ArtifactKind,
    download: () => Promise<BoldSignPdfArtifact>,
    storage: OutputStorageService,
  ): Promise<StoredArtifact> {
    const artifact = await download();
    const suffix = kind === 'signed_document' ? 'signed' : 'audit-trail';
    const key = `crew-agreements/${job.agreement.crewId}/${job.agreementId}/${suffix}.pdf`;
    const placement = await storage.createPrivateUploadUrl({
      storageKey: key,
      contentType: 'application/pdf',
      maxBytes: artifact.bytes.length,
      expiresInSeconds: 120,
    });
    if (placement.storageKey !== key || !placement.bucket) {
      throw new ServiceUnavailableException(
        'Invalid private agreement archive destination.',
      );
    }
    // Keep the write capability server-side; general media uploads may use a
    // public bucket regardless of MediaAsset.visibility in the database.
    const response = await fetch(placement.url, {
      method: 'PUT',
      headers: { ...placement.headers, 'content-type': 'application/pdf' },
      body: new Uint8Array(artifact.bytes),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    await response.body?.cancel();
    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Private agreement archive upload failed.',
      );
    }
    const stored = await storage.headStoredObject({
      bucket: placement.bucket,
      storageKey: key,
      region: placement.region,
    });
    if (
      !stored.exists ||
      stored.sizeBytes !== artifact.bytes.length ||
      stored.contentType?.split(';')[0] !== 'application/pdf'
    ) {
      throw new ServiceUnavailableException(
        `Private agreement archive verification failed for ${kind}.`,
      );
    }
    return {
      kind,
      result: {
        url: '',
        storagePath: key,
        bytes: stored.sizeBytes,
        provider: placement.provider,
        bucket: placement.bucket,
        region: placement.region,
      },
      checksumSha256: createHash('sha256').update(artifact.bytes).digest('hex'),
      filename: `${safeFilenameStem(job.agreement.title)}-${suffix}.pdf`,
    };
  }

  private async persistArchive(
    job: ClaimedArchiveJob,
    signed: StoredArtifact,
    audit: StoredArtifact,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const leased = await tx.crewAgreementArchiveJob.findUnique({
        where: { id: job.id },
      });
      if (!ownsLease(leased, job)) return;

      const agreement = await tx.crewAgreement.findUniqueOrThrow({
        where: { id: job.agreementId },
      });
      await lockCrewAssetFolderNames(tx, agreement.crewId, null);
      const usedNames = new Set(
        (
          await tx.crewAssetNode.findMany({
            where: {
              crewId: agreement.crewId,
              parentId: null,
              status: 'active',
            },
            select: { name: true },
          })
        ).map((node) => node.name.toLowerCase()),
      );

      const assetNodeId =
        agreement.assetNodeId ??
        (await this.createRestrictedAsset(tx, agreement, signed, usedNames));
      const auditAssetNodeId =
        agreement.auditAssetNodeId ??
        (await this.createRestrictedAsset(tx, agreement, audit, usedNames));
      await tx.crewAgreement.update({
        where: { id: agreement.id },
        data: { assetNodeId, auditAssetNodeId },
      });
      const acknowledged = await tx.crewAgreementArchiveJob.updateMany({
        where: leaseWhere(job),
        data: {
          status: CrewAgreementArchiveJobStatus.completed,
          completedAt: new Date(),
          nextAttemptAt: null,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
      if (acknowledged.count !== 1) {
        // Throw inside the transaction so assets and agreement links created
        // after the initial lease read cannot commit for a displaced worker.
        throw new Error(`Crew agreement archive lease lost job=${job.id}`);
      }
    });
  }

  private async createRestrictedAsset(
    tx: Prisma.TransactionClient,
    agreement: ClaimedArchiveJob['agreement'],
    artifact: StoredArtifact,
    usedNames: Set<string>,
  ): Promise<string> {
    const storageProvider = artifact.result.provider as MediaStorageProvider;
    const media = await tx.mediaAsset.create({
      data: {
        kind: MediaAssetKind.document,
        storageProvider,
        bucket: artifact.result.bucket,
        region: artifact.result.region,
        objectKey: artifact.result.storagePath,
        contentType: 'application/pdf',
        sizeBytes: BigInt(artifact.result.bytes),
        checksumSha256: artifact.checksumSha256,
        visibility: MediaAssetVisibility.private,
        status: MediaAssetStatus.ready,
        source: MediaAssetSource.system,
        createdByUserId: agreement.createdByUserId,
        metadata: {
          uploadKind: 'crew_agreement_archive',
          crewId: agreement.crewId,
          agreementId: agreement.id,
          artifactKind: artifact.kind,
          provider: agreement.provider,
          providerDocumentId: agreement.providerDocumentId,
        },
      },
      select: { id: true },
    });
    await ensureOriginalMediaPlacement(tx, {
      assetId: media.id,
      storageProvider,
      bucket: artifact.result.bucket,
      region: artifact.result.region,
      objectKey: artifact.result.storagePath,
      contentType: 'application/pdf',
      sizeBytes: artifact.result.bytes,
      checksumSha256: artifact.checksumSha256,
      metadata: {
        source: 'crew_agreement_archive',
        artifactKind: artifact.kind,
      },
    });

    const name = availableCrewAssetName(artifact.filename, usedNames);
    usedNames.add(name.toLowerCase());
    const node = await tx.crewAssetNode.create({
      data: {
        crewId: agreement.crewId,
        parentId: null,
        kind: CrewAssetNodeKind.file,
        accessMode: CrewAssetAccessMode.restricted,
        name,
        mediaAssetId: media.id,
        createdByUserId: agreement.createdByUserId,
        updatedByUserId: agreement.createdByUserId,
      },
      select: { id: true, permissionVersion: true },
    });
    const grants = new Map<string, CrewAssetPermission>([
      [agreement.memberUserId, CrewAssetPermission.view],
      [agreement.createdByUserId, CrewAssetPermission.manage],
    ]);
    await tx.crewAssetGrant.createMany({
      data: [...grants].map(([userId, permission]) => ({
        nodeId: node.id,
        userId,
        permission,
        grantedByUserId: agreement.createdByUserId,
      })),
    });
    await tx.crewAssetPermissionEvent.create({
      data: {
        crewId: agreement.crewId,
        nodeId: node.id,
        actorUserId: agreement.createdByUserId,
        action: 'system_archive',
        previousMode: CrewAssetAccessMode.inherit,
        nextMode: CrewAssetAccessMode.restricted,
        previousVersion: 0,
        nextVersion: node.permissionVersion,
        previousGrants: [],
        nextGrants: [...grants].map(([userId, permission]) => ({
          userId,
          permission,
        })),
      },
    });
    return node.id;
  }

  private async acknowledgeExistingArchive(
    job: ClaimedArchiveJob,
  ): Promise<void> {
    await this.prisma.crewAgreementArchiveJob.updateMany({
      where: leaseWhere(job),
      data: {
        status: CrewAgreementArchiveJobStatus.completed,
        completedAt: new Date(),
        nextAttemptAt: null,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    });
  }

  private async recordFailure(
    job: ClaimedArchiveJob,
    error: unknown,
  ): Promise<void> {
    const attempt = job.attempt + 1;
    const terminal = attempt >= MAX_ATTEMPTS;
    const backoff = BACKOFFS_MS[Math.min(job.attempt, BACKOFFS_MS.length - 1)];
    const message = errorMessage(error).slice(0, 2_000);
    const result = await this.prisma.crewAgreementArchiveJob.updateMany({
      where: leaseWhere(job),
      data: {
        status: terminal
          ? CrewAgreementArchiveJobStatus.failed
          : CrewAgreementArchiveJobStatus.pending,
        attempt,
        nextAttemptAt: terminal ? null : new Date(Date.now() + backoff),
        lockedAt: null,
        lockedBy: null,
        lastError: message,
      },
    });
    if (result.count === 0) {
      this.logger.warn(
        `Crew agreement archive lease lost after failure job=${job.id}`,
      );
      return;
    }
    this.logger.warn(
      `Crew agreement archive failed agreement=${job.agreementId} attempt=${attempt}/${MAX_ATTEMPTS}${
        terminal ? ' → manual retry required' : ''
      }: ${message}`,
    );
  }
}

interface StoredArtifact {
  kind: ArtifactKind;
  result: OutputStorageResult;
  checksumSha256: string;
  filename: string;
}

function leaseWhere(job: ClaimedArchiveJob) {
  return {
    id: job.id,
    status: CrewAgreementArchiveJobStatus.processing,
    lockedAt: job.lockedAt,
    lockedBy: WORKER_ID,
  } satisfies Prisma.CrewAgreementArchiveJobWhereInput;
}

function ownsLease(
  current: {
    status: CrewAgreementArchiveJobStatus;
    lockedAt: Date | null;
    lockedBy: string | null;
  } | null,
  job: ClaimedArchiveJob,
): boolean {
  return Boolean(
    current &&
    current.status === CrewAgreementArchiveJobStatus.processing &&
    current.lockedBy === WORKER_ID &&
    current.lockedAt?.getTime() === job.lockedAt?.getTime(),
  );
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function safeFilenameStem(value: string): string {
  const normalized = [...value.normalize('NFKC')]
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized || 'crew-agreement').slice(0, 180);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
