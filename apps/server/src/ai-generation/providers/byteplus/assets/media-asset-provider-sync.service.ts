import { backgroundTasksEnabled } from '../../../../common/background-tasks';
import { requireNonReceiptAsset } from '../../../../media/media-receipt-policy';
import {
  ConflictException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue, Worker, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import { assetsUserGroup, type AssetEvent } from '@repo/shared';
import {
  AiOutboxEventType,
  AiProviderAssetGroupStatus,
  AiProviderAssetGroupType,
  AiProviderExternalAssetStatus,
  MediaAssetKind,
  MediaAssetStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../infra/db/db.module';
import { MediaAssetUrlResolverService } from '../../../../infra/storage/media-asset-url-resolver.service';
import { enqueueRealtimeEvent } from '../../../outbox.service';
import { createAiRedisConnection } from '../../../queue';
import {
  BytePlusAssetsApiError,
  BytePlusAssetsClient,
  redactAssetRecord,
  type BytePlusAssetRecord,
  type BytePlusAssetType,
} from './byteplus-assets-client';
import { BytePlusAssetsConfigService } from './byteplus-assets-config.service';

export const MEDIA_ASSETS_QUEUE = 'ai-media-assets';
export const MEDIA_ASSETS_CRITICAL_QUEUE = 'ai-media-assets-critical';

const PROVIDER_KEY = 'byteplus-modelark';
const PROCESSING_DEADLINE_MS = 30 * 60_000;
const POLL_DELAY_MS = 8_000;
const STALE_SWEEP_INTERVAL_MS = 60_000;
const TEARDOWN_REENQUEUE_GRACE_MS = 5 * 60_000;
const CREATE_ASSET_LIMITER = { max: 100, duration: 60_000 };
const BACKPRESSURE_WARN_DEPTH = 500;
const REGISTER_PRIORITY_FOREGROUND = 1;
const STATUS_QUERY_LIMIT = 100;
const PROVIDER_ASSET_TYPE_BY_KIND: Partial<
  Record<MediaAssetKind, BytePlusAssetType>
> = {
  [MediaAssetKind.image]: 'Image',
  [MediaAssetKind.video]: 'Video',
};
const SUPPORTED_MEDIA_KINDS = [
  MediaAssetKind.image,
  MediaAssetKind.video,
] as const;

type MediaAssetsJobData =
  | { op: 'register'; mirrorId: string }
  | { op: 'poll'; mirrorId: string };

type CriticalJobData =
  | { op: 'delete_asset'; externalAssetId: string }
  | { op: 'delete_group'; externalGroupId: string };

type MirrorRow = Prisma.AiProviderMediaAssetMirrorGetPayload<{
  include: typeof MIRROR_INCLUDE;
}>;

const MIRROR_INCLUDE = {
  assetGroup: true,
  mediaAsset: true,
} satisfies Prisma.AiProviderMediaAssetMirrorInclude;

export interface MediaProviderAssetStatusDto {
  assetId: string;
  status: AiProviderExternalAssetStatus;
  statusReason?: string | null;
  updatedAt: string;
}

@Injectable()
export class MediaAssetProviderSyncService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MediaAssetProviderSyncService.name);
  private connection: Redis | null = null;
  private assetsQueue: Queue<MediaAssetsJobData> | null = null;
  private criticalQueue: Queue<CriticalJobData> | null = null;
  private workers: Worker[] = [];
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: BytePlusAssetsConfigService,
    private readonly client: BytePlusAssetsClient,
    private readonly urls: MediaAssetUrlResolverService,
  ) {}

  isEnabled(): boolean {
    return this.configService.config.mediaAssetRegistrationEnabled;
  }

  onApplicationBootstrap(): void {
    if (!backgroundTasksEnabled()) return;
    if (!this.configService.config.mediaAssetRegistrationEnabled) return;
    const connection = this.redis();
    this.workers = [
      new Worker<MediaAssetsJobData>(
        MEDIA_ASSETS_QUEUE,
        this.processAssetsJob,
        {
          connection,
          concurrency: 4,
          limiter: CREATE_ASSET_LIMITER,
        },
      ),
      new Worker<CriticalJobData>(
        MEDIA_ASSETS_CRITICAL_QUEUE,
        this.processCriticalJob,
        { connection, concurrency: 4 },
      ),
    ];
    this.sweepTimer = setInterval(() => {
      void this.sweepStaleMirrors();
      void this.reconcileTeardowns();
      void this.reportBackpressure();
    }, STALE_SWEEP_INTERVAL_MS);
    this.logger.log('MediaAsset provider sync lanes running (assets plane on)');
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await Promise.allSettled(this.workers.map((worker) => worker.close()));
    await Promise.allSettled([
      this.assetsQueue?.close() ?? Promise.resolve(),
      this.criticalQueue?.close() ?? Promise.resolve(),
    ]);
    this.connection?.disconnect();
  }

  async enqueueAssetRegistration(
    mediaAssetId: string,
    priority = REGISTER_PRIORITY_FOREGROUND,
  ): Promise<string | null> {
    // Uploads retain their durable asset without starting automatic provider
    // registration; null expressly means no registration was created.
    if (!backgroundTasksEnabled()) return null;
    if (!this.configService.config.mediaAssetRegistrationEnabled) return null;

    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: mediaAssetId,
        deletedAt: null,
        status: MediaAssetStatus.ready,
        moderationStatus: { not: 'blocked' },
        kind: { in: [...SUPPORTED_MEDIA_KINDS] },
      },
      select: { id: true, metadata: true },
    });
    if (!asset) return null;
    requireNonReceiptAsset(asset.metadata);

    const groupId = await this.ensureAigcMediaAssetGroup();
    if (!groupId) return null;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM media_assets WHERE id = ${mediaAssetId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM ai_provider_media_asset_groups WHERE id = ${groupId}::uuid FOR SHARE`;
      const current = await tx.mediaAsset.findFirst({
        where: {
          id: mediaAssetId,
          deletedAt: null,
          status: MediaAssetStatus.ready,
          moderationStatus: { not: 'blocked' },
          kind: { in: [...SUPPORTED_MEDIA_KINDS] },
        },
        select: { id: true, metadata: true },
      });
      const group = await tx.aiProviderMediaAssetGroup.findFirst({
        where: { id: groupId, status: AiProviderAssetGroupStatus.active },
        select: { id: true },
      });
      if (!current || !group) return null;
      requireNonReceiptAsset(current.metadata);
      const existing = await tx.aiProviderMediaAssetMirror.findUnique({
        where: {
          mediaAssetId_providerAssetGroupId: {
            mediaAssetId,
            providerAssetGroupId: groupId,
          },
        },
        select: { id: true },
      });
      if (existing) return { id: existing.id, created: false };
      const mirror = await tx.aiProviderMediaAssetMirror.create({
        data: {
          mediaAssetId,
          providerAssetGroupId: groupId,
          status: AiProviderExternalAssetStatus.pending,
          processingDeadline: new Date(Date.now() + PROCESSING_DEADLINE_MS),
        },
        select: { id: true },
      });
      return { id: mirror.id, created: true };
    });
    if (!result) return null;
    if (result.created) await this.enqueueRegister(result.id, priority);
    return result.id;
  }

  /**
   * User-triggered assurance seam for the canvas. Existing work is resumed,
   * not duplicated: pending registrations are re-kicked, processing mirrors
   * are polled, and failed operational attempts resume from the last durable
   * provider identity when one exists.
   */
  async requestAssetRegistration(
    mediaAssetId: string,
  ): Promise<MediaProviderAssetStatusDto | null> {
    if (!backgroundTasksEnabled())
      throw new ConflictException(
        'Background tasks are disabled in this environment.',
      );
    if (!this.configService.config.mediaAssetRegistrationEnabled) return null;

    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: mediaAssetId,
        deletedAt: null,
        status: MediaAssetStatus.ready,
        moderationStatus: { not: 'blocked' },
        kind: { in: [...SUPPORTED_MEDIA_KINDS] },
      },
      select: { id: true, metadata: true },
    });
    if (!asset) return null;
    requireNonReceiptAsset(asset.metadata);

    const groupId = await this.ensureAigcMediaAssetGroup();
    if (!groupId) return null;

    let row = await this.prisma.aiProviderMediaAssetMirror.findUnique({
      where: {
        mediaAssetId_providerAssetGroupId: {
          mediaAssetId,
          providerAssetGroupId: groupId,
        },
      },
      include: MIRROR_INCLUDE,
    });
    if (!row) {
      const mirrorId = await this.enqueueAssetRegistration(mediaAssetId);
      if (!mirrorId) return null;
      row = await this.prisma.aiProviderMediaAssetMirror.findUnique({
        where: { id: mirrorId },
        include: MIRROR_INCLUDE,
      });
      return row
        ? mediaProviderAssetStatusDto(row)
        : {
            assetId: mediaAssetId,
            status: AiProviderExternalAssetStatus.pending,
            statusReason: null,
            updatedAt: new Date().toISOString(),
          };
    }

    if (row.status === AiProviderExternalAssetStatus.failed) {
      const failedRow = row;
      const eligible = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM media_assets WHERE id = ${mediaAssetId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM ai_provider_media_asset_groups WHERE id = ${groupId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM ai_provider_media_asset_mirrors WHERE id = ${failedRow.id}::uuid FOR UPDATE`;
        const asset = await tx.mediaAsset.findFirst({
          where: {
            id: mediaAssetId,
            deletedAt: null,
            status: MediaAssetStatus.ready,
            moderationStatus: { not: 'blocked' },
            kind: { in: [...SUPPORTED_MEDIA_KINDS] },
          },
          select: { id: true, metadata: true },
        });
        const group = await tx.aiProviderMediaAssetGroup.findFirst({
          where: { id: groupId, status: AiProviderAssetGroupStatus.active },
          select: { id: true },
        });
        if (!asset || !group) return false;
        requireNonReceiptAsset(asset.metadata);
        const current = await tx.aiProviderMediaAssetMirror.findUnique({
          where: { id: failedRow.id },
          include: MIRROR_INCLUDE,
        });
        if (!current) return false;
        if (current.status !== AiProviderExternalAssetStatus.failed)
          return true;
        const nextStatus = current.externalAssetId
          ? AiProviderExternalAssetStatus.processing
          : AiProviderExternalAssetStatus.pending;
        const processingDeadline = new Date(
          Date.now() + PROCESSING_DEADLINE_MS,
        );
        const { count } = await tx.aiProviderMediaAssetMirror.updateMany({
          where: {
            id: failedRow.id,
            status: AiProviderExternalAssetStatus.failed,
          },
          data: {
            status: nextStatus,
            statusReason: null,
            providerResponse: Prisma.DbNull,
            processingDeadline,
            lastSyncedAt: new Date(),
          },
        });
        if (count === 0) return false;
        await this.emitMediaAssetEvent(tx, current, nextStatus, null);
        return true;
      });
      if (!eligible) return null;
      row = await this.prisma.aiProviderMediaAssetMirror.findUnique({
        where: { id: failedRow.id },
        include: MIRROR_INCLUDE,
      });
      if (!row) return null;
    }

    // Minute-bucketed id: repeated manual kicks within the same minute dedupe
    // onto one job instead of stacking. Colons are forbidden (see enqueue*).
    const manualBucket = Math.floor(Date.now() / 60_000);
    if (row.status === AiProviderExternalAssetStatus.pending) {
      await this.enqueueRegister(
        row.id,
        REGISTER_PRIORITY_FOREGROUND,
        `register-${row.id}-manual-${manualBucket}`,
      );
    } else if (row.status === AiProviderExternalAssetStatus.processing) {
      await this.enqueuePoll(row.id, `poll-${row.id}-manual-${manualBucket}`);
    }
    return mediaProviderAssetStatusDto(row);
  }

  async listStatuses(
    assetIds: string[],
  ): Promise<MediaProviderAssetStatusDto[]> {
    if (!this.configService.config.mediaAssetRegistrationEnabled) return [];
    const ids = [...new Set(assetIds)].slice(0, STATUS_QUERY_LIMIT);
    if (ids.length === 0) return [];

    const mirrors = await this.prisma.aiProviderMediaAssetMirror.findMany({
      where: {
        mediaAssetId: { in: ids },
        assetGroup: {
          provider: PROVIDER_KEY,
          groupType: AiProviderAssetGroupType.aigc,
          projectName: this.configService.config.projectName,
        },
      },
      orderBy: { updatedAt: 'desc' },
      distinct: ['mediaAssetId'],
      select: {
        mediaAssetId: true,
        status: true,
        statusReason: true,
        updatedAt: true,
      },
    });

    return mirrors.map((mirror) => ({
      assetId: mirror.mediaAssetId,
      status: mirror.status,
      statusReason: mirror.statusReason,
      updatedAt: mirror.updatedAt.toISOString(),
    }));
  }

  private async ensureAigcMediaAssetGroup(): Promise<string | null> {
    if (!backgroundTasksEnabled()) return null;
    if (!this.configService.config.mediaAssetRegistrationEnabled) return null;
    const projectName = this.configService.config.projectName;
    const existing = await this.prisma.aiProviderMediaAssetGroup.findUnique({
      where: {
        provider_groupType_projectName: {
          provider: PROVIDER_KEY,
          groupType: AiProviderAssetGroupType.aigc,
          projectName,
        },
      },
      select: { id: true, status: true },
    });
    if (existing) {
      return existing.status === AiProviderAssetGroupStatus.active
        ? existing.id
        : null;
    }

    let externalGroupId: string;
    try {
      const created = await this.client.createAssetGroup({
        name: `media-assets-${projectName}`,
        description: 'FizzDragon canvas MediaAsset AIGC checks',
      });
      externalGroupId = created.Id;
    } catch (err) {
      this.logger.warn(
        `ensureAigcMediaAssetGroup failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return null;
    }

    const group = await this.prisma.aiProviderMediaAssetGroup
      .upsert({
        where: {
          provider_groupType_projectName: {
            provider: PROVIDER_KEY,
            groupType: AiProviderAssetGroupType.aigc,
            projectName,
          },
        },
        create: {
          provider: PROVIDER_KEY,
          externalGroupId,
          groupType: AiProviderAssetGroupType.aigc,
          projectName,
          status: AiProviderAssetGroupStatus.active,
        },
        update: {},
        select: { id: true, externalGroupId: true, status: true },
      })
      .catch(async (error: unknown) => {
        // The provider already created this group; a failed local publication
        // must still request cleanup, without masking the original DB failure.
        try {
          await this.enqueueCriticalTeardown({
            externalAssetIds: [],
            externalGroupIds: [externalGroupId],
          });
        } catch {
          this.logger.warn(
            `Unable to queue orphan provider group cleanup: ${externalGroupId}`,
          );
        }
        throw error;
      });
    if (group.externalGroupId !== externalGroupId) {
      // Group-identity drift cleanup is best-effort: a queue/Redis fault must
      // not 500 the user-facing readiness request — the periodic teardown
      // reconciler (reconcileTeardowns) will pick the orphan up.
      await this.enqueueCriticalTeardown({
        externalAssetIds: [],
        externalGroupIds: [externalGroupId],
      }).catch((error: unknown) => {
        this.logger.warn(
          `Unable to queue drifted provider group cleanup: ${externalGroupId}: ${String(
            error instanceof Error ? error.message : error,
          )}`,
        );
      });
    }
    return group.status === AiProviderAssetGroupStatus.active ? group.id : null;
  }

  // Custom job ids must not contain ':' — BullMQ treats it as a Redis key
  // separator and REJECTS the add synchronously (which 500s the user-facing
  // readiness request). The legacy `a:b:c` 3-segment form is still tolerated
  // for old repeatable jobs, but only as a deprecated compatibility window.
  private async enqueueRegister(
    mirrorId: string,
    priority = REGISTER_PRIORITY_FOREGROUND,
    jobId = `register-${mirrorId}-${Date.now()}`,
  ): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    await this.queue().add(
      'register',
      { op: 'register', mirrorId },
      { jobId, priority },
    );
  }

  private async enqueuePoll(
    mirrorId: string,
    jobId = `poll-${mirrorId}-${Date.now()}`,
  ): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    await this.queue().add(
      'poll',
      { op: 'poll', mirrorId },
      { delay: POLL_DELAY_MS, jobId },
    );
  }

  private async enqueueCriticalTeardown(args: {
    externalAssetIds: string[];
    externalGroupIds: string[];
  }): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    const queue = this.critical();
    await queue.addBulk([
      ...args.externalAssetIds.map((externalAssetId) => ({
        name: 'delete_asset',
        data: { op: 'delete_asset', externalAssetId } as CriticalJobData,
        opts: { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
      })),
      ...args.externalGroupIds.map((externalGroupId) => ({
        name: 'delete_group',
        data: { op: 'delete_group', externalGroupId } as CriticalJobData,
        opts: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          delay: 15_000,
        },
      })),
    ]);
  }

  private processAssetsJob: Processor<MediaAssetsJobData> = async (job) => {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping) return;
    const row = await this.prisma.aiProviderMediaAssetMirror.findUnique({
      where: { id: job.data.mirrorId },
      include: MIRROR_INCLUDE,
    });
    if (this.stopping || !row) return;
    if (row.assetGroup.status !== AiProviderAssetGroupStatus.active) return;

    if (job.data.op === 'register') {
      await this.register(row);
    } else {
      await this.poll(row);
    }
  };

  private async register(row: MirrorRow): Promise<void> {
    if (row.status !== AiProviderExternalAssetStatus.pending) {
      if (
        row.status === AiProviderExternalAssetStatus.processing &&
        row.externalAssetId
      ) {
        await this.enqueuePoll(row.id);
      }
      return;
    }

    const url = this.urls.resolvePublicUrl(row.mediaAsset);
    const assetType = PROVIDER_ASSET_TYPE_BY_KIND[row.mediaAsset.kind];
    if (!url || !assetType) {
      await this.transition(row, AiProviderExternalAssetStatus.failed, {
        statusReason: 'unresolvable_media',
      });
      return;
    }

    let createdId: string;
    try {
      const created = await this.client.createAsset({
        groupId: row.assetGroup.externalGroupId,
        url,
        assetType,
        name: row.mediaAsset.id,
      });
      createdId = created.Id;
    } catch (err) {
      await this.transition(row, AiProviderExternalAssetStatus.failed, {
        statusReason: typedReasonFromError(err),
        providerResponse: apiErrorSnapshot(err),
      });
      return;
    }

    const applied = await this.prisma
      .$transaction(async (tx) => {
        const { count } = await tx.aiProviderMediaAssetMirror.updateMany({
          where: {
            id: row.id,
            status: AiProviderExternalAssetStatus.pending,
            updatedAt: row.updatedAt,
            externalAssetId: row.externalAssetId,
          },
          data: {
            status: AiProviderExternalAssetStatus.processing,
            externalAssetId: createdId,
            statusReason: null,
            processingDeadline: new Date(Date.now() + PROCESSING_DEADLINE_MS),
            lastSyncedAt: new Date(),
          },
        });
        if (count === 0) return false;
        await this.emitMediaAssetEvent(
          tx,
          row,
          AiProviderExternalAssetStatus.processing,
          null,
        );
        return true;
      })
      .catch(async (error: unknown) => {
        try {
          await this.enqueueCriticalTeardown({
            externalAssetIds: [createdId],
            externalGroupIds: [],
          });
        } catch {
          this.logger.warn(
            `Unable to queue orphan provider asset cleanup: ${createdId}`,
          );
        }
        throw error;
      });
    if (!applied) {
      await this.enqueueCriticalTeardown({
        externalAssetIds: [createdId],
        externalGroupIds: [],
      });
      return;
    }
    await this.enqueuePoll(row.id);
  }

  private async poll(row: MirrorRow): Promise<void> {
    if (
      row.status !== AiProviderExternalAssetStatus.processing ||
      !row.externalAssetId
    )
      return;
    let record: BytePlusAssetRecord;
    try {
      record = await this.client.getAsset(row.externalAssetId);
    } catch (err) {
      if (this.pastDeadline(row)) {
        await this.transition(row, AiProviderExternalAssetStatus.failed, {
          statusReason: 'stale',
          providerResponse: apiErrorSnapshot(err),
        });
        return;
      }
      await this.enqueuePoll(row.id);
      return;
    }

    if (record.Status === 'Active') {
      await this.transition(row, AiProviderExternalAssetStatus.active, {
        providerResponse: redactAssetRecord(record),
      });
      return;
    }
    if (record.Status === 'Failed') {
      await this.transition(row, AiProviderExternalAssetStatus.failed, {
        statusReason: typedReasonFromCode(record.Error?.Code),
        providerResponse: redactAssetRecord(record),
      });
      return;
    }
    if (this.pastDeadline(row)) {
      await this.transition(row, AiProviderExternalAssetStatus.failed, {
        statusReason: 'stale',
        providerResponse: redactAssetRecord(record),
      });
      return;
    }
    await this.enqueuePoll(row.id);
  }

  private processCriticalJob: Processor<CriticalJobData> = async (job) => {
    if (!backgroundTasksEnabled()) return;
    try {
      if (job.data.op === 'delete_asset') {
        await this.client.deleteAsset(job.data.externalAssetId);
      } else {
        await this.client.deleteAssetGroup(job.data.externalGroupId);
      }
    } catch (err) {
      if (
        !(
          err instanceof BytePlusAssetsApiError &&
          /not.?found|not.?exist/i.test(`${err.code} ${err.message}`)
        )
      ) {
        throw err;
      }
    }
    if (job.data.op === 'delete_asset') {
      await this.prisma.aiProviderMediaAssetMirror.updateMany({
        where: {
          externalAssetId: job.data.externalAssetId,
          status: { not: AiProviderExternalAssetStatus.deleted },
        },
        data: { status: AiProviderExternalAssetStatus.deleted },
      });
    } else {
      await this.prisma.aiProviderMediaAssetGroup.updateMany({
        where: {
          externalGroupId: job.data.externalGroupId,
          status: { not: AiProviderAssetGroupStatus.deleted },
        },
        data: { status: AiProviderAssetGroupStatus.deleted },
      });
    }
  };

  private async reconcileTeardowns(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (
      this.stopping ||
      !this.configService.config.mediaAssetRegistrationEnabled
    )
      return;
    const graceCutoff = new Date(Date.now() - TEARDOWN_REENQUEUE_GRACE_MS);
    try {
      const assets = await this.prisma.aiProviderMediaAssetMirror.findMany({
        where: {
          status: AiProviderExternalAssetStatus.disabled,
          externalAssetId: { not: null },
          updatedAt: { lt: graceCutoff },
        },
        select: { externalAssetId: true },
        take: 100,
      });
      if (this.stopping) return;
      const groups = await this.prisma.aiProviderMediaAssetGroup.findMany({
        where: {
          status: AiProviderAssetGroupStatus.disabled,
          updatedAt: { lt: graceCutoff },
        },
        select: { externalGroupId: true },
        take: 100,
      });
      if (this.stopping || (assets.length === 0 && groups.length === 0)) return;
      await this.enqueueCriticalTeardown({
        externalAssetIds: assets
          .map((asset) => asset.externalAssetId)
          .filter((id): id is string => Boolean(id)),
        externalGroupIds: groups.map((group) => group.externalGroupId),
      });
    } catch (err) {
      this.logger.warn(
        `media asset teardown reconciliation failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  private async reportBackpressure(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping) return;
    try {
      const waiting = await this.queue().getWaitingCount();
      if (!this.stopping && waiting >= BACKPRESSURE_WARN_DEPTH) {
        const drainMinutes = Math.ceil(waiting / CREATE_ASSET_LIMITER.max);
        this.logger.warn(
          `ai-media-assets registration backlog: ${waiting} queued (~${drainMinutes} min to drain at ${CREATE_ASSET_LIMITER.max}/min)`,
        );
      }
    } catch {
      // Metric only.
    }
  }

  private async sweepStaleMirrors(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (
      this.stopping ||
      this.sweeping ||
      !this.configService.config.mediaAssetRegistrationEnabled
    ) {
      return;
    }
    this.sweeping = true;
    try {
      const stuck = await this.prisma.aiProviderMediaAssetMirror.findMany({
        where: {
          status: {
            in: [
              AiProviderExternalAssetStatus.pending,
              AiProviderExternalAssetStatus.processing,
            ],
          },
          processingDeadline: { lt: new Date() },
        },
        include: MIRROR_INCLUDE,
        take: 50,
      });
      for (const row of stuck) {
        if (this.stopping) return;
        await this.transition(row, AiProviderExternalAssetStatus.failed, {
          statusReason: 'stale',
        });
      }
    } catch (err) {
      this.logger.warn(
        `media asset stale mirror sweep failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
    } finally {
      this.sweeping = false;
    }
  }

  private async transition(
    row: MirrorRow,
    status: AiProviderExternalAssetStatus,
    patch: {
      statusReason?: string | null;
      providerResponse?: Record<string, unknown>;
      processingDeadline?: Date;
    },
  ): Promise<void> {
    if (
      row.status !== AiProviderExternalAssetStatus.pending &&
      row.status !== AiProviderExternalAssetStatus.processing
    )
      return;
    const updatedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.aiProviderMediaAssetMirror.updateMany({
        where: {
          id: row.id,
          status: row.status,
          updatedAt: row.updatedAt,
          externalAssetId: row.externalAssetId,
        },
        data: {
          status,
          statusReason: patch.statusReason ?? null,
          ...(patch.providerResponse
            ? {
                providerResponse:
                  patch.providerResponse as Prisma.InputJsonValue,
              }
            : {}),
          ...(patch.processingDeadline
            ? { processingDeadline: patch.processingDeadline }
            : {}),
          lastSyncedAt: updatedAt,
        },
      });
      if (count === 0) return;
      await this.emitMediaAssetEvent(
        tx,
        row,
        status,
        patch.statusReason ?? null,
      );
    });
  }

  private async emitMediaAssetEvent(
    tx: Prisma.TransactionClient,
    row: MirrorRow,
    status: AiProviderExternalAssetStatus,
    statusReason: string | null,
  ): Promise<void> {
    const userId = row.mediaAsset.createdByUserId;
    if (!userId) return;
    const now = new Date();
    const event: AssetEvent = {
      kind: 'media_provider_asset_updated',
      assetId: row.mediaAssetId,
      workspaceId: row.mediaAsset.workspaceId,
      mirrorStatus: status,
      statusReason,
      updatedAt: now.toISOString(),
      ts: now.getTime(),
    };
    await enqueueRealtimeEvent(tx, {
      channel: assetsUserGroup(userId),
      userId,
      eventType: AiOutboxEventType.media_provider_asset_updated,
      payload: event as unknown as Prisma.InputJsonValue,
    });
  }

  private pastDeadline(row: MirrorRow): boolean {
    return (
      row.processingDeadline != null && row.processingDeadline < new Date()
    );
  }

  private redis(): Redis {
    if (!this.connection) this.connection = createAiRedisConnection();
    return this.connection;
  }

  private queue(): Queue<MediaAssetsJobData> {
    if (!this.assetsQueue) {
      this.assetsQueue = new Queue<MediaAssetsJobData>(MEDIA_ASSETS_QUEUE, {
        connection: this.redis(),
        defaultJobOptions: {
          removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
          removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
          attempts: 1,
        },
      });
    }
    return this.assetsQueue;
  }

  private critical(): Queue<CriticalJobData> {
    if (!this.criticalQueue) {
      this.criticalQueue = new Queue<CriticalJobData>(
        MEDIA_ASSETS_CRITICAL_QUEUE,
        {
          connection: this.redis(),
          defaultJobOptions: {
            removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
            removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
          },
        },
      );
    }
    return this.criticalQueue;
  }
}

function mediaProviderAssetStatusDto(
  row: Pick<
    MirrorRow,
    'mediaAssetId' | 'status' | 'statusReason' | 'updatedAt'
  >,
): MediaProviderAssetStatusDto {
  return {
    assetId: row.mediaAssetId,
    status: row.status,
    statusReason: row.statusReason,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function typedReasonFromCode(code: string | undefined): string {
  if (!code) return 'failed';
  if (/face.*(mismatch|not.?match)|different.?person/i.test(code)) {
    return 'face_mismatch';
  }
  if (/multi.*face/i.test(code)) return 'multi_face';
  if (/moderat|risk|sensitive|prefilter/i.test(code)) return 'moderation';
  return code.toLowerCase().slice(0, 64);
}

function typedReasonFromError(err: unknown): string {
  return err instanceof BytePlusAssetsApiError
    ? typedReasonFromCode(err.code)
    : 'register_failed';
}

function apiErrorSnapshot(err: unknown): Record<string, unknown> {
  if (err instanceof BytePlusAssetsApiError) {
    return {
      action: err.action,
      code: err.code,
      message: err.message.slice(0, 300),
      requestId: err.requestId ?? null,
    };
  }
  return {
    message: err instanceof Error ? err.message.slice(0, 300) : 'unknown',
  };
}
