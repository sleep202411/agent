import { backgroundTasksEnabled } from '../../../../common/background-tasks';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue, Worker, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  AiOutboxEventType,
  AiProviderAssetGroupStatus,
  AiProviderAssetGroupType,
  AiProviderExternalAssetStatus,
  MediaAssetKind,
  type AiProviderExternalAsset,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../infra/db/db.module';
import { MediaAssetUrlResolverService } from '../../../../infra/storage/media-asset-url-resolver.service';
import { enqueueAssetEventOutbox } from '../../../outbox.service';
import { createAiRedisConnection } from '../../../queue';
import {
  BytePlusAssetsApiError,
  BytePlusAssetsClient,
  redactAssetRecord,
  type BytePlusAssetType,
} from './byteplus-assets-client';
import { BytePlusAssetsConfigService } from './byteplus-assets-config.service';

/**
 * Dual-lane provider sync for character asset mirrors (design §2.2).
 * Lane names use repo dash convention for the design's `ai:assets` /
 * `ai:assets-critical` lanes:
 *  - `ai-assets`          — register (CreateAsset) + poll (GetAsset). Rate
 *    limited by a BullMQ distributed limiter to stay under the ACCOUNT-WIDE
 *    CreateAsset cap (120 QPM on ACR) — a per-user cooldown cannot enforce
 *    an account-wide cap (§6.3).
 *  - `ai-assets-critical` — delete/disable fan-out. Consent revocation and
 *    takedown must NEVER queue behind an enrollment burst or rebuild storm.
 *
 * Registration is EAGER at media-attach; enrollment UX is leave-and-notify —
 * every state transition emits a `character_media_updated` asset event
 * (outbox → assets-user channel) instead of making anyone block-and-spin.
 * CreateAsset has no SLA: rows stuck past `processingDeadline` flip to
 * failed(stale) via the poll path or the sweeper.
 */

export const ASSETS_QUEUE = 'ai-assets';
export const ASSETS_CRITICAL_QUEUE = 'ai-assets-critical';

/** The single provider that backs the character asset planes. */
const PROVIDER_KEY = 'byteplus-modelark';

/** processingDeadline horizon (§2.2 leave-and-notify). */
const PROCESSING_DEADLINE_MS = 30 * 60_000;
const POLL_DELAY_MS = 8_000;
const STALE_SWEEP_INTERVAL_MS = 60_000;
/** Grace before a still-`disabled` teardown is re-enqueued (lost-enqueue). */
const TEARDOWN_REENQUEUE_GRACE_MS = 5 * 60_000;
/** Headroom under the 120 QPM account cap, shared across pods via BullMQ. */
const CREATE_ASSET_LIMITER = { max: 100, duration: 60_000 };
/** CreateVisualValidateSession upstream cap: 3 QPS account-wide (§6.3). */
const VISUAL_SESSION_QPS = 3;
/** BullMQ register-job priority tiers (lower runs sooner). */
const REGISTER_PRIORITY_FOREGROUND = 1;
/** Log an ai-assets backpressure warning above this queued depth. */
const BACKPRESSURE_WARN_DEPTH = 500;

type AssetsJobData =
  | { op: 'register'; externalAssetRowId: string }
  | { op: 'poll'; externalAssetRowId: string };

type CriticalJobData =
  | { op: 'delete_asset'; externalAssetId: string }
  | { op: 'delete_group'; externalGroupId: string };

const ASSET_TYPE_BY_KIND: Partial<Record<MediaAssetKind, BytePlusAssetType>> = {
  [MediaAssetKind.image]: 'Image',
  [MediaAssetKind.video]: 'Video',
  [MediaAssetKind.audio]: 'Audio',
};

type MirrorRow = Prisma.AiProviderExternalAssetGetPayload<{
  include: {
    assetGroup: {
      include: {
        character: {
          select: {
            id: true;
            name: true;
            workspaceId: true;
            createdByUserId: true;
            subjectUserId: true;
          };
        };
      };
    };
    characterMedia: { include: { mediaAsset: true } };
  };
}>;

const MIRROR_INCLUDE = {
  assetGroup: {
    include: {
      character: {
        select: {
          id: true,
          name: true,
          workspaceId: true,
          createdByUserId: true,
          subjectUserId: true,
        },
      },
    },
  },
  characterMedia: { include: { mediaAsset: true } },
} satisfies Prisma.AiProviderExternalAssetInclude;

@Injectable()
export class CharacterProviderSyncService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CharacterProviderSyncService.name);
  private connection: Redis | null = null;
  private assetsQueue: Queue<AssetsJobData> | null = null;
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

  onApplicationBootstrap(): void {
    if (!backgroundTasksEnabled()) return;
    if (!this.configService.config.assetsPlaneEnabled) return;
    const connection = this.redis();
    this.workers = [
      new Worker<AssetsJobData>(ASSETS_QUEUE, this.processAssetsJob, {
        connection,
        concurrency: 4,
        // Distributed across pods: the limiter state lives in Redis, so this
        // enforces the ACCOUNT-wide upstream cap, not a per-pod one.
        limiter: CREATE_ASSET_LIMITER,
      }),
      new Worker<CriticalJobData>(
        ASSETS_CRITICAL_QUEUE,
        this.processCriticalJob,
        { connection, concurrency: 4 },
      ),
    ];
    this.sweepTimer = setInterval(() => {
      void this.sweepStaleMirrors();
      void this.reconcileTeardowns();
      void this.reportBackpressure();
    }, STALE_SWEEP_INTERVAL_MS);
    this.logger.log('Character provider sync lanes running (assets plane on)');
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

  // ── Producers (called by the characters module) ─────────────────────────

  /**
   * Ensure the character's AIGC digital-human asset group exists (virtual
   * characters, design "AIGC" group type — the only type CreateAssetGroup
   * accepts). Idempotent: reuses the existing active group or creates one
   * upstream + mirrors it locally. Called at first virtual media-attach.
   * Returns the local group id, or null if the plane is unavailable (the
   * caller then skips registration and the character stays URL-only).
   */
  async ensureAigcGroup(characterId: string): Promise<string | null> {
    // Attaching user media remains available; null means no provider group
    // was provisioned, using the existing best-effort registration contract.
    if (!backgroundTasksEnabled()) return null;
    if (!this.configService.config.aigcRegistrationEnabled) return null;
    const eligible = await this.prisma.studioCharacter.findFirst({
      where: {
        id: characterId,
        kind: 'virtual',
        status: 'active',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!eligible) return null;
    const existing = await this.prisma.aiProviderAssetGroup.findUnique({
      where: {
        characterId_provider: { characterId, provider: PROVIDER_KEY },
      },
      select: { id: true, status: true, groupType: true },
    });
    if (existing) {
      // A revoked/disabled group is terminal — don't resurrect it here.
      return existing.status === AiProviderAssetGroupStatus.active
        ? existing.id
        : null;
    }
    let externalGroupId: string;
    try {
      const created = await this.client.createAssetGroup({
        name: `char-${characterId}`,
        description: 'FizzDragon AIGC digital-human character',
      });
      externalGroupId = created.Id;
    } catch (err) {
      this.logger.warn(
        `ensureAigcGroup failed for ${characterId}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
    // Upsert guards the create-race (two attaches at once): the unique
    // (characterId, provider) makes the loser reuse the winner's row.
    const group = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM studio_characters WHERE id = ${characterId}::uuid FOR UPDATE`;
        const current = await tx.studioCharacter.findFirst({
          where: {
            id: characterId,
            kind: 'virtual',
            status: 'active',
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!current) return null;
        return tx.aiProviderAssetGroup.upsert({
          where: {
            characterId_provider: { characterId, provider: PROVIDER_KEY },
          },
          create: {
            characterId,
            provider: PROVIDER_KEY,
            externalGroupId,
            groupType: AiProviderAssetGroupType.aigc,
            projectName: this.configService.config.projectName,
            status: AiProviderAssetGroupStatus.active,
          },
          update: {},
          select: { id: true, externalGroupId: true, status: true },
        });
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
    // If we lost the race our just-created upstream group is an orphan —
    // tear it down on the critical lane.
    if (!group || group.externalGroupId !== externalGroupId) {
      await this.enqueueCriticalTeardown({
        externalAssetIds: [],
        externalGroupIds: [externalGroupId],
      });
    }
    return group?.status === AiProviderAssetGroupStatus.active
      ? group.id
      : null;
  }

  /**
   * Eager mirror registration at media-attach (design §2.2): creates the
   * pending row in the CALLER's transaction, then enqueues the register job
   * after commit (caller invokes `enqueueRegister` with the returned id).
   */
  async createPendingMirror(
    tx: Prisma.TransactionClient,
    args: { characterMediaId: string; providerAssetGroupId: string },
  ): Promise<AiProviderExternalAsset> {
    return tx.aiProviderExternalAsset.upsert({
      where: {
        characterMediaId_providerAssetGroupId: {
          characterMediaId: args.characterMediaId,
          providerAssetGroupId: args.providerAssetGroupId,
        },
      },
      create: {
        characterMediaId: args.characterMediaId,
        providerAssetGroupId: args.providerAssetGroupId,
        status: AiProviderExternalAssetStatus.pending,
        processingDeadline: new Date(Date.now() + PROCESSING_DEADLINE_MS),
      },
      update: {
        status: AiProviderExternalAssetStatus.pending,
        statusReason: null,
        processingDeadline: new Date(Date.now() + PROCESSING_DEADLINE_MS),
      },
    });
  }

  /**
   * Enqueue a registration. `priority` (BullMQ: lower = sooner) lets a
   * foreground attach a user is about to generate with beat a future bulk
   * backfill sharing the account-wide 120 QPM CreateAsset budget. Default is
   * the foreground tier; a backfill sweep would pass a higher number.
   */
  async enqueueRegister(
    externalAssetRowId: string,
    priority = REGISTER_PRIORITY_FOREGROUND,
  ): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    await this.queue().add(
      'register',
      { op: 'register', externalAssetRowId },
      // Colons are forbidden in custom job ids (BullMQ Redis key separator);
      // the legacy 3-segment form is a deprecated compatibility window only.
      { jobId: `register-${externalAssetRowId}-${Date.now()}`, priority },
    );
  }

  /**
   * §5.1 revocation fan-out — the revoke TRANSACTION already flipped rows to
   * disabled (the consent barrier); this schedules the upstream deletes on
   * the critical lane. Best-effort by design: a failure never re-enables
   * anything, retries are BullMQ-backed.
   */
  async enqueueCriticalTeardown(args: {
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
          // Group deletion after its assets: a small fixed delay is enough —
          // DeleteAssetGroup retries anyway if assets are still draining.
          delay: 15_000,
        },
      })),
    ]);
  }

  /**
   * Account-wide 3 QPS token gate for CreateVisualValidateSession (§6.3):
   * fixed 1-second Redis window — the upstream cap is per second, so a
   * fixed window is exact here, and per-user cooldowns stay abuse-hygiene.
   * Returns false when the caller must 429.
   */
  async reserveVisualValidateSlot(): Promise<boolean> {
    const second = Math.floor(Date.now() / 1000);
    const key = `ratelimit:byteplus:visual-session:${second}`;
    const redis = this.redis();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 2);
    return count <= VISUAL_SESSION_QPS;
  }

  // ── Consumers ───────────────────────────────────────────────────────────

  private processAssetsJob: Processor<AssetsJobData> = async (job) => {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping) return;
    const row = await this.prisma.aiProviderExternalAsset.findUnique({
      where: { id: job.data.externalAssetRowId },
      include: MIRROR_INCLUDE,
    });
    if (this.stopping || !row) return;
    // A disabled group means the character was revoked mid-flight — the
    // critical lane owns teardown; this lane just stops touching the row.
    if (row.assetGroup.status !== AiProviderAssetGroupStatus.active) return;

    if (job.data.op === 'register') {
      await this.register(row);
    } else {
      await this.poll(row);
    }
  };

  private async register(row: MirrorRow): Promise<void> {
    // Idempotency: only a PENDING row registers. A redelivered job whose row
    // already advanced (processing with an id) is a stall retry — resume the
    // poll instead of calling CreateAsset again (which would mint a second,
    // orphaned upstream face asset). Any other status = the row was
    // disabled/failed/deleted meanwhile; do nothing.
    if (row.status !== AiProviderExternalAssetStatus.pending) {
      if (
        row.status === AiProviderExternalAssetStatus.processing &&
        row.externalAssetId
      ) {
        await this.enqueuePoll(row.id);
      }
      return;
    }

    // A pending row always has its media (detached rows are disabled); guard
    // anyway since characterMedia is nullable (SetNull on media deletion).
    const media = row.characterMedia;
    const assetType = media ? ASSET_TYPE_BY_KIND[media.mediaKind] : undefined;
    const url = media
      ? this.urls.resolvePublicUrl(media.mediaAsset)
      : undefined;
    if (!media || !assetType || !url) {
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
        name: media.id,
      });
      createdId = created.Id;
    } catch (err) {
      await this.transition(row, AiProviderExternalAssetStatus.failed, {
        statusReason: typedReasonFromError(err),
        providerResponse: apiErrorSnapshot(err),
      });
      return;
    }

    // Compensating commit: keep the new upstream id ONLY if the row is still
    // pending. A concurrent revoke (flips row → disabled in one tx) or a
    // removeMedia (cascade-deletes the row) makes this updateMany match 0
    // rows — the just-created upstream face asset then has no local owner, so
    // tear it down on the critical lane rather than orphan it. (revoke's own
    // teardown snapshot was taken BEFORE this asset existed, so only this
    // path can clean it up.)
    const applied = await this.prisma
      .$transaction(async (tx) => {
        const { count } = await tx.aiProviderExternalAsset.updateMany({
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
        await this.emitMediaEvent(
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

  private async enqueuePoll(externalAssetRowId: string): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    await this.queue().add(
      'poll',
      { op: 'poll', externalAssetRowId },
      {
        delay: POLL_DELAY_MS,
        jobId: `poll-${externalAssetRowId}-${Date.now()}`,
      },
    );
  }

  private async poll(row: MirrorRow): Promise<void> {
    if (
      row.status !== AiProviderExternalAssetStatus.processing ||
      !row.externalAssetId
    )
      return;
    let record: Awaited<ReturnType<BytePlusAssetsClient['getAsset']>>;
    try {
      record = await this.client.getAsset(row.externalAssetId);
    } catch (err) {
      // GetAsset is cheap and idempotent — transient failures just re-poll
      // until the staleness deadline turns the row over.
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
      // Idempotency: an already-deleted upstream resource is success.
      if (
        !(
          err instanceof BytePlusAssetsApiError &&
          /not.?found|not.?exist/i.test(`${err.code} ${err.message}`)
        )
      ) {
        throw err; // BullMQ retries with backoff (attempts: 5).
      }
    }
    // Upstream is gone (deleted now, or already absent) — advance the durable
    // local state to `deleted` so the reconciliation sweep stops re-driving
    // it. A detached orphan row (characterMediaId=null, from removeMedia) has
    // no ledger value once the upstream asset is gone, so hard-delete it.
    if (job.data.op === 'delete_asset') {
      await this.prisma.aiProviderExternalAsset.updateMany({
        where: {
          externalAssetId: job.data.externalAssetId,
          status: { not: AiProviderExternalAssetStatus.deleted },
        },
        data: { status: AiProviderExternalAssetStatus.deleted },
      });
      await this.prisma.aiProviderExternalAsset.deleteMany({
        where: {
          externalAssetId: job.data.externalAssetId,
          characterMediaId: null,
        },
      });
    } else {
      await this.prisma.aiProviderAssetGroup.updateMany({
        where: {
          externalGroupId: job.data.externalGroupId,
          status: { not: AiProviderAssetGroupStatus.deleted },
        },
        data: { status: AiProviderAssetGroupStatus.deleted },
      });
    }
  };

  /**
   * Reconciliation sweep (§5.1 re-drivability): teardown is enqueued AFTER
   * the revoke/removeMedia commit, so a crash in that window leaves the
   * durable `disabled` rows with the upstream asset still live. Re-enqueue
   * delete jobs for any `disabled` group/asset that has lingered past a short
   * grace — upstream deletes are idempotent (not-found = success), so
   * re-driving is safe. A detached (characterMediaId=null) `disabled` asset
   * is a removeMedia orphan; its group may still be active, so it is swept on
   * the asset lane independent of the group.
   */
  private async reconcileTeardowns(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping || !this.configService.config.assetsPlaneEnabled) return;
    const graceCutoff = new Date(Date.now() - TEARDOWN_REENQUEUE_GRACE_MS);
    try {
      const assets = await this.prisma.aiProviderExternalAsset.findMany({
        where: {
          status: AiProviderExternalAssetStatus.disabled,
          externalAssetId: { not: null },
          updatedAt: { lt: graceCutoff },
        },
        select: { externalAssetId: true },
        take: 100,
      });
      if (this.stopping) return;
      const groups = await this.prisma.aiProviderAssetGroup.findMany({
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
          .map((a) => a.externalAssetId)
          .filter((id): id is string => Boolean(id)),
        externalGroupIds: groups.map((g) => g.externalGroupId),
      });
    } catch (err) {
      this.logger.warn(
        `teardown reconciliation failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Backpressure visibility (option A eager-registers every virtual image
   * through the account-wide 120 QPM budget): surface a warning when the
   * ai-assets registration queue backs up, so a bulk-import spike is
   * observable rather than silently draining over many minutes.
   */
  private async reportBackpressure(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping) return;
    try {
      const waiting = await this.queue().getWaitingCount();
      if (!this.stopping && waiting >= BACKPRESSURE_WARN_DEPTH) {
        const drainMinutes = Math.ceil(waiting / CREATE_ASSET_LIMITER.max);
        this.logger.warn(
          `ai-assets registration backlog: ${waiting} queued (~${drainMinutes} min to drain at ${CREATE_ASSET_LIMITER.max}/min)`,
        );
      }
    } catch {
      // Metric only — never let a Redis hiccup disturb the sweep loop.
    }
  }

  /** Safety net for lost poll jobs (§2.2 staleness rule). */
  private async sweepStaleMirrors(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (
      this.stopping ||
      this.sweeping ||
      !this.configService.config.assetsPlaneEnabled
    )
      return;
    this.sweeping = true;
    try {
      const stuck = await this.prisma.aiProviderExternalAsset.findMany({
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
        `stale mirror sweep failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.sweeping = false;
    }
  }

  // ── State transition + leave-and-notify event ───────────────────────────

  private async transition(
    row: MirrorRow,
    status: AiProviderExternalAssetStatus,
    patch: {
      externalAssetId?: string;
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
      // Guarded transition: only advance a row that is STILL pending/processing.
      // A concurrent poll (row already active) or a second-pod sweeper must
      // match 0 rows so it can neither flip an active mirror back to
      // failed(stale) nor emit a duplicate outbox event. Every legitimate
      // transition in this service starts from pending/processing.
      const { count } = await tx.aiProviderExternalAsset.updateMany({
        where: {
          id: row.id,
          status: row.status,
          updatedAt: row.updatedAt,
          externalAssetId: row.externalAssetId,
        },
        data: {
          status,
          statusReason: patch.statusReason ?? null,
          ...(patch.externalAssetId
            ? { externalAssetId: patch.externalAssetId }
            : {}),
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
      await this.emitMediaEvent(tx, row, status, patch.statusReason ?? null);
    });
  }

  /** Enqueue the leave-and-notify event for a mirror row's new state. */
  private async emitMediaEvent(
    tx: Prisma.TransactionClient,
    row: MirrorRow,
    status: AiProviderExternalAssetStatus,
    statusReason: string | null,
  ): Promise<void> {
    const character = row.assetGroup.character;
    const now = new Date();
    await enqueueAssetEventOutbox(tx, {
      userId: character.subjectUserId ?? character.createdByUserId,
      eventType: AiOutboxEventType.character_media_updated,
      payload: {
        kind: 'character_media_updated',
        characterId: character.id,
        workspaceId: character.workspaceId,
        characterMediaId: row.characterMediaId ?? undefined,
        mirrorStatus: status,
        statusReason,
        updatedAt: now.toISOString(),
        ts: now.getTime(),
      },
    });
  }

  private pastDeadline(row: MirrorRow): boolean {
    return (
      row.processingDeadline != null && row.processingDeadline < new Date()
    );
  }

  // ── Lazy infra ──────────────────────────────────────────────────────────

  private redis(): Redis {
    if (!this.connection) this.connection = createAiRedisConnection();
    return this.connection;
  }

  private queue(): Queue<AssetsJobData> {
    if (!this.assetsQueue) {
      this.assetsQueue = new Queue<AssetsJobData>(ASSETS_QUEUE, {
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
      this.criticalQueue = new Queue<CriticalJobData>(ASSETS_CRITICAL_QUEUE, {
        connection: this.redis(),
        defaultJobOptions: {
          removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
          removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
        },
      });
    }
    return this.criticalQueue;
  }
}

/**
 * Map upstream verdict codes to our typed reasons (design §2.2: surfaced
 * verbatim to the UI). The public docs do not enumerate the codes, so this
 * is pattern-based over observed shapes — unknown codes pass through
 * lowercased rather than being swallowed.
 */
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

/** Redacted snapshot of an API failure for the mirror row. */
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
