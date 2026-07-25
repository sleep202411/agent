import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetSource,
  MediaAssetStatus,
  MediaStorageProvider,
  Prisma,
  StudioAgentArtifactCleanupStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from '../infra/db/db.module';
import {
  MediaStorageAccessService,
  type MediaStorageObjectRef,
} from '../infra/storage/media-storage-access.service';
import { StudioAgentConfigService } from './studio-agent.config';

const STUDIO_AGENT_IMAGE_UPLOAD_KIND = 'studio_agent_image';
const STUDIO_AGENT_IMAGE_FINAL_SEGMENT = '/studio-agent-image-final/';
const STUDIO_AGENT_DOCUMENT_UPLOAD_KIND = 'studio_agent_document';
const STUDIO_AGENT_DOCUMENT_SEGMENT = '/studio-agent-document/';
const DISCOVERY_STALL_POLL_INTERVALS = 10;

interface ClaimedArtifact {
  id: string;
  mediaAssetId: string | null;
  leaseToken: string;
  attemptCount: number;
}

interface ClaimedOrphanMedia {
  id: string;
  mediaAssetId: string;
  leaseToken: string;
  attemptCount: number;
}

type CleanupPreparation =
  | { state: 'lost' | 'complete' }
  | {
      state: 'delete';
      object: MediaStorageObjectRef;
    };

/**
 * Crash-safe storage reclamation for abandoned composer attachments.
 *
 * Claiming is multi-pod safe through SKIP LOCKED and a durable lease. Media is
 * first made inaccessible in the database, then deleted idempotently from its
 * owning provider. A crash at any boundary leaves a scheduled/stale lease that
 * another pod can finish.
 */
@Injectable()
export class StudioAgentArtifactCleanupWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(StudioAgentArtifactCleanupWorker.name);
  private readonly workerId = `studio-agent-artifact-cleanup:${hostname()}:${process.pid}:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: StudioAgentConfigService,
    private readonly storage: MediaStorageAccessService,
  ) {}

  onApplicationBootstrap(): void {
    const interval = this.config.value.attachmentCleanup.pollIntervalMs;
    this.timer = setInterval(() => this.runScheduledDrain(), interval);
    this.timer.unref?.();
    this.runScheduledDrain();
    this.logger.log(
      `Studio Agent attachment cleanup running every ${interval}ms (${this.workerId})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      await this.draining;
    } catch (cause) {
      const error = normalizeError(cause);
      this.logger.warn(
        `Attachment cleanup drain ended during shutdown code=${error.code}: ${error.message}`,
      );
    }
  }

  private runScheduledDrain(): void {
    void this.drainOnce().catch((cause: unknown) => {
      const error = normalizeError(cause);
      this.logger.error(
        `Attachment cleanup sweep failed code=${error.code}: ${error.message}`,
      );
    });
  }

  async drainOnce(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = this.drainClaimed().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drainClaimed(): Promise<void> {
    await this.discoverOrphanMedia();
    const batchSize = this.config.value.attachmentCleanup.batchSize;
    const artifacts = await this.claim(batchSize);
    const remaining = Math.max(0, batchSize - artifacts.length);
    const orphanMedia =
      remaining === 0 ? [] : await this.claimOrphanMedia(remaining);
    await Promise.all([
      ...artifacts.map((artifact) => this.cleanupOne(artifact)),
      ...orphanMedia.map((orphan) => this.cleanupOrphanMedia(orphan)),
    ]);
  }

  /**
   * Covers the upload-confirm -> artifact-registration crash window.
   *
   * The watermark is what keeps this cheap: each sweep adjudicates a bounded
   * (created_at, id) range exactly once, hands every asset without an owning
   * artifact to a durable cleanup job, and advances past the range in the same
   * statement — so the position can never outrun the obligations it implies and
   * a healthy attachment is never re-examined.
   *
   * Because adjudication is final, nothing may silently drop an asset's owner.
   * `prepareCleanup` hands reclamation back to a job when an abandoned artifact
   * abdicates a still-shared asset; a future hard delete of a thread (artifacts
   * cascade) must do the same, because discovery will not find those assets
   * again.
   */
  private async discoverOrphanMedia(): Promise<void> {
    const settings = this.config.value.attachmentCleanup;
    // The upload kinds are inlined rather than bound: PostgreSQL matches the
    // partial discovery index only against an identical Const expression, and a
    // bind parameter silently drops the plan to a full media_assets range scan.
    await this.prisma.$executeRaw`
      WITH cursor_row AS MATERIALIZED (
        SELECT
          discovery."scanned_through_created_at" AS created_at,
          discovery."scanned_through_asset_id" AS asset_id,
          now() - make_interval(
            secs => ${settings.ttlMs}::double precision / 1000.0
          ) AS cutoff
        FROM "studio_agent_orphan_discovery_cursor" AS discovery
        WHERE discovery."id" = 'singleton'
        FOR UPDATE SKIP LOCKED
      ),
      examined AS MATERIALIZED (
        SELECT asset."id", asset."created_at"
        FROM cursor_row
        CROSS JOIN LATERAL (
          SELECT candidate."id", candidate."created_at"
          FROM "media_assets" AS candidate
          WHERE (candidate."created_at", candidate."id")
                  > (cursor_row.created_at, cursor_row.asset_id)
            AND candidate."created_at" <= cursor_row.cutoff
            AND candidate."metadata"->>'uploadKind'
                  IN ('studio_agent_image', 'studio_agent_document')
            AND candidate."deleted_at" IS NULL
            AND candidate."status" = 'ready'
            AND candidate."source" = 'user_upload'
          ORDER BY candidate."created_at", candidate."id"
          LIMIT ${settings.discoveryBatchSize}
        ) AS asset
      ),
      unowned AS MATERIALIZED (
        SELECT examined."id"
        FROM examined
        WHERE NOT EXISTS (
          SELECT 1
          FROM "studio_agent_artifacts" AS artifact
          WHERE artifact."media_asset_id" = examined."id"
            AND artifact."cleanup_status" <> 'cleaned'
        )
      ),
      scheduled AS (
        INSERT INTO "studio_agent_orphan_media_cleanup_jobs" (
          "media_asset_id",
          "status",
          "not_before",
          "next_attempt_at"
        )
        SELECT
          unowned."id",
          'scheduled'::"StudioAgentArtifactCleanupStatus",
          now(),
          now()
        FROM unowned
        ON CONFLICT ("media_asset_id") DO NOTHING
      )
      UPDATE "studio_agent_orphan_discovery_cursor" AS discovery
      SET
        "scanned_through_created_at" = advanced.created_at,
        "scanned_through_asset_id" = advanced.id,
        "updated_at" = now()
      FROM (
        -- Driven off cursor_row, so a sweep that lost the lock updates nothing.
        -- An empty range was fully adjudicated, so the position moves to the
        -- cutoff rather than standing still at the seed forever.
        SELECT
          COALESCE(newest.created_at, cursor_row.cutoff) AS created_at,
          COALESCE(
            newest.id,
            '00000000-0000-0000-0000-000000000000'::uuid
          ) AS id
        FROM cursor_row
        LEFT JOIN LATERAL (
          SELECT examined."created_at", examined."id"
          FROM examined
          ORDER BY examined."created_at" DESC, examined."id" DESC
          LIMIT 1
        ) AS newest ON TRUE
      ) AS advanced
      WHERE discovery."id" = 'singleton'
    `;
    await this.warnIfDiscoveryStalled();
  }

  /**
   * The watermark is the only place a stalled discovery is visible: a sweep
   * that adjudicates nothing is indistinguishable from one that lost the lock,
   * and a dropped index or a deleted cursor row simply produces no work.
   */
  private async warnIfDiscoveryStalled(): Promise<void> {
    const settings = this.config.value.attachmentCleanup;
    const graceMs =
      settings.ttlMs + settings.pollIntervalMs * DISCOVERY_STALL_POLL_INTERVALS;
    // `-infinity` is a legal watermark and PostgreSQL 16 refuses to subtract
    // infinite timestamps, so staleness is a comparison, never an interval.
    const [cursor] = await this.prisma.$queryRaw<
      Array<{ position: string; stalled: boolean }>
    >`
      SELECT
        discovery."scanned_through_created_at"::text AS "position",
        discovery."scanned_through_created_at"
          < now() - make_interval(
              secs => ${graceMs}::double precision / 1000.0
            ) AS "stalled"
      FROM "studio_agent_orphan_discovery_cursor" AS discovery
      WHERE discovery."id" = 'singleton'
    `;
    if (!cursor) {
      this.logger.error(
        'Studio Agent orphan discovery cursor is missing; attachment discovery is disabled.',
      );
      return;
    }
    if (cursor.stalled) {
      this.logger.warn(
        `Studio Agent orphan discovery is behind its reclamation deadline watermark=${cursor.position}`,
      );
    }
  }

  private async claim(limit: number): Promise<ClaimedArtifact[]> {
    const now = new Date();
    const leaseExpiresAt = new Date(
      now.getTime() + this.config.value.attachmentCleanup.leaseMs,
    );
    const leaseToken = randomUUID();
    return this.prisma.$queryRaw<ClaimedArtifact[]>`
      WITH candidates AS (
        SELECT artifact."id"
        FROM "studio_agent_artifacts" AS artifact
        WHERE artifact."message_id" IS NULL
          AND artifact."run_id" IS NULL
          AND artifact."action_id" IS NULL
          AND (
            (
              artifact."cleanup_status" = 'active'
              AND artifact."cleanup_expires_at" IS NOT NULL
              AND artifact."cleanup_expires_at" <= ${now}
            )
            OR
            (
              artifact."cleanup_status" = 'scheduled'
              AND artifact."cleanup_next_attempt_at" <= ${now}
            )
            OR
            (
              artifact."cleanup_status" = 'leased'
              AND artifact."cleanup_lease_expires_at" <= ${now}
            )
          )
        ORDER BY
          COALESCE(
            artifact."cleanup_next_attempt_at",
            artifact."cleanup_expires_at",
            artifact."created_at"
          ),
          artifact."created_at",
          artifact."id"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "studio_agent_artifacts" AS artifact
      SET
        "cleanup_status" = 'leased',
        "cleanup_reason" = COALESCE(
          artifact."cleanup_reason",
          'expired'::"StudioAgentArtifactCleanupReason"
        ),
        "cleanup_requested_at" = COALESCE(
          artifact."cleanup_requested_at",
          ${now}
        ),
        "cleanup_next_attempt_at" = COALESCE(
          artifact."cleanup_next_attempt_at",
          ${now}
        ),
        "cleanup_attempt_count" = artifact."cleanup_attempt_count" + 1,
        "cleanup_lease_token" = ${leaseToken}::uuid,
        "cleanup_lease_owner" = ${this.workerId},
        "cleanup_lease_acquired_at" = ${now},
        "cleanup_lease_expires_at" = ${leaseExpiresAt},
        "cleanup_last_error_code" = NULL,
        "cleanup_last_error_detail" = NULL
      FROM candidates
      WHERE artifact."id" = candidates."id"
      RETURNING
        artifact."id",
        artifact."media_asset_id" AS "mediaAssetId",
        artifact."cleanup_lease_token" AS "leaseToken",
        artifact."cleanup_attempt_count" AS "attemptCount"
    `;
  }

  private async claimOrphanMedia(limit: number): Promise<ClaimedOrphanMedia[]> {
    const now = new Date();
    const leaseExpiresAt = new Date(
      now.getTime() + this.config.value.attachmentCleanup.leaseMs,
    );
    const leaseToken = randomUUID();
    return this.prisma.$queryRaw<ClaimedOrphanMedia[]>`
      WITH candidates AS (
        SELECT cleanup."id"
        FROM "studio_agent_orphan_media_cleanup_jobs" AS cleanup
        WHERE cleanup."not_before" <= ${now}
          AND (
            (
              cleanup."status" = 'scheduled'
              AND cleanup."next_attempt_at" <= ${now}
            )
            OR
            (
              cleanup."status" = 'leased'
              AND cleanup."lease_expires_at" <= ${now}
            )
          )
        ORDER BY cleanup."next_attempt_at", cleanup."created_at", cleanup."id"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "studio_agent_orphan_media_cleanup_jobs" AS cleanup
      SET
        "status" = 'leased',
        "attempt_count" = cleanup."attempt_count" + 1,
        "lease_token" = ${leaseToken}::uuid,
        "lease_owner" = ${this.workerId},
        "lease_acquired_at" = ${now},
        "lease_expires_at" = ${leaseExpiresAt},
        "last_error_code" = NULL,
        "last_error_detail" = NULL,
        "updated_at" = ${now}
      FROM candidates
      WHERE cleanup."id" = candidates."id"
      RETURNING
        cleanup."id",
        cleanup."media_asset_id" AS "mediaAssetId",
        cleanup."lease_token" AS "leaseToken",
        cleanup."attempt_count" AS "attemptCount"
    `;
  }

  private async cleanupOne(artifact: ClaimedArtifact): Promise<void> {
    try {
      const preparation = await this.prepareCleanup(artifact);
      if (preparation.state !== 'delete') return;
      await this.storage.deleteObject(preparation.object);
      await this.markCleaned(artifact);
    } catch (cause) {
      await this.recordFailure(artifact, cause);
    }
  }

  private async cleanupOrphanMedia(orphan: ClaimedOrphanMedia): Promise<void> {
    try {
      const preparation = await this.prepareOrphanMediaCleanup(orphan);
      if (preparation.state !== 'delete') return;
      await this.storage.deleteObject(preparation.object);
      await this.markOrphanMediaCleaned(orphan);
    } catch (cause) {
      await this.recordOrphanMediaFailure(orphan, cause);
    }
  }

  /**
   * Atomically decides ownership and reference safety while holding row locks.
   * `FOR UPDATE` on MediaAsset prevents a concurrent foreign-key binding from
   * acquiring its key-share lock until the asset has been soft-deleted.
   */
  private async prepareCleanup(
    claimed: ClaimedArtifact,
  ): Promise<CleanupPreparation> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "studio_agent_artifacts"
        WHERE "id" = ${claimed.id}::uuid
        FOR UPDATE
      `;
      const artifact = await tx.studioAgentArtifact.findFirst({
        where: {
          id: claimed.id,
          messageId: null,
          cleanupStatus: StudioAgentArtifactCleanupStatus.leased,
          cleanupLeaseToken: claimed.leaseToken,
          cleanupLeaseOwner: this.workerId,
        },
        select: {
          id: true,
          mediaAssetId: true,
          mediaAsset: {
            select: {
              id: true,
              kind: true,
              source: true,
              status: true,
              storageProvider: true,
              bucket: true,
              region: true,
              objectKey: true,
              metadata: true,
              deletedAt: true,
            },
          },
        },
      });
      if (!artifact) return { state: 'lost' };
      if (!artifact.mediaAssetId || !artifact.mediaAsset) {
        await this.markCleanedInTransaction(tx, claimed);
        return { state: 'complete' };
      }

      await tx.$queryRaw`
        SELECT "id"
        FROM "media_assets"
        WHERE "id" = ${artifact.mediaAssetId}::uuid
        FOR UPDATE
      `;
      const asset = await tx.mediaAsset.findUnique({
        where: { id: artifact.mediaAssetId },
        select: {
          id: true,
          kind: true,
          source: true,
          status: true,
          storageProvider: true,
          bucket: true,
          region: true,
          objectKey: true,
          metadata: true,
          deletedAt: true,
        },
      });
      if (!asset) {
        await this.markCleanedInTransaction(tx, claimed);
        return { state: 'complete' };
      }

      const dedicated = isDedicatedStudioAgentAsset(asset);
      const [referenceCheck] = await tx.$queryRaw<
        Array<{ hasReference: boolean; ownedByArtifact: boolean }>
      >`
        SELECT
          "studio_agent_media_asset_has_live_reference"(
            ${asset.id}::uuid,
            ${artifact.id}::uuid
          ) AS "hasReference",
          EXISTS (
            SELECT 1
            FROM "studio_agent_artifacts" AS other
            WHERE other."media_asset_id" = ${asset.id}::uuid
              AND other."id" <> ${artifact.id}::uuid
              AND other."cleanup_status" <> 'cleaned'
          ) AS "ownedByArtifact"
      `;

      // An unexpected/non-dedicated asset or a shared asset is detached from
      // this abandoned artifact but its bytes and media row remain untouched.
      // Another artifact still owns reclamation; anything else does not, and
      // discovery adjudicates each asset once and has already passed this one —
      // so a durable job takes over as the fallback owner.
      if (!dedicated || referenceCheck?.hasReference !== false) {
        if (dedicated && referenceCheck?.ownedByArtifact === false) {
          await this.scheduleOrphanMediaRecheck(tx, asset.id);
        }
        await this.markCleanedInTransaction(tx, claimed);
        return { state: 'complete' };
      }

      if (!asset.bucket || !asset.objectKey) {
        throw Object.assign(
          new Error('Dedicated Studio Agent media is missing its placement.'),
          { code: 'STUDIO_AGENT_ATTACHMENT_STORAGE_REF_INVALID' },
        );
      }

      if (
        asset.status !== MediaAssetStatus.deleted ||
        asset.deletedAt === null
      ) {
        await tx.mediaAsset.update({
          where: { id: asset.id },
          data: {
            status: MediaAssetStatus.deleted,
            deletedAt: new Date(),
          },
        });
      }
      return {
        state: 'delete',
        object: {
          storageProvider: asset.storageProvider,
          bucket: asset.bucket,
          region: asset.region,
          objectKey: asset.objectKey,
        },
      };
    });
  }

  /**
   * Re-checks orphanhood under a MediaAsset write lock. Registration takes a
   * share lock on the same row, so exactly one side wins: either the artifact
   * becomes visible to this reference check, or registration observes the
   * retired asset and rejects it. No confirmed upload can be deleted while it
   * is being attached to a conversation.
   */
  private async prepareOrphanMediaCleanup(
    claimed: ClaimedOrphanMedia,
  ): Promise<CleanupPreparation> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "studio_agent_orphan_media_cleanup_jobs"
        WHERE "id" = ${claimed.id}::uuid
        FOR UPDATE
      `;
      const job = await tx.studioAgentOrphanMediaCleanupJob.findFirst({
        where: {
          id: claimed.id,
          mediaAssetId: claimed.mediaAssetId,
          status: StudioAgentArtifactCleanupStatus.leased,
          leaseToken: claimed.leaseToken,
          leaseOwner: this.workerId,
        },
        select: {
          id: true,
          mediaAssetId: true,
        },
      });
      if (!job) return { state: 'lost' };

      await tx.$queryRaw`
        SELECT "id"
        FROM "media_assets"
        WHERE "id" = ${job.mediaAssetId}::uuid
        FOR UPDATE
      `;
      const asset = await tx.mediaAsset.findUnique({
        where: { id: job.mediaAssetId },
        select: {
          id: true,
          kind: true,
          source: true,
          status: true,
          storageProvider: true,
          bucket: true,
          region: true,
          objectKey: true,
          metadata: true,
          deletedAt: true,
        },
      });
      if (!asset) {
        await this.markOrphanMediaCleanedInTransaction(tx, claimed);
        return { state: 'complete' };
      }

      const [referenceCheck] = await tx.$queryRaw<
        Array<{ hasReference: boolean; ownedByArtifact: boolean }>
      >`
        SELECT
          "studio_agent_media_asset_has_live_reference"(
            ${asset.id}::uuid,
            NULL::uuid
          ) AS "hasReference",
          EXISTS (
            SELECT 1
            FROM "studio_agent_artifacts" AS artifact
            WHERE artifact."media_asset_id" = ${asset.id}::uuid
              AND artifact."cleanup_status" <> 'cleaned'
          ) AS "ownedByArtifact"
      `;
      if (!isDedicatedStudioAgentAsset(asset)) {
        await this.markOrphanMediaCleanedInTransaction(tx, claimed);
        return { state: 'complete' };
      }
      if (referenceCheck?.hasReference !== false) {
        // An artifact owns its own reclamation and hands this job back if it
        // ever abdicates a still-shared asset. Any other binding has no such
        // handoff, so the job stays the owner and re-checks after another
        // grace period — discovery will never look at this asset again.
        if (referenceCheck?.ownedByArtifact === true) {
          await this.markOrphanMediaCleanedInTransaction(tx, claimed);
        } else {
          await this.deferOrphanMediaCleanupInTransaction(tx, claimed);
        }
        return { state: 'complete' };
      }

      if (!asset.bucket || !asset.objectKey) {
        throw Object.assign(
          new Error('Dedicated Studio Agent media is missing its placement.'),
          { code: 'STUDIO_AGENT_ATTACHMENT_STORAGE_REF_INVALID' },
        );
      }
      if (
        asset.status !== MediaAssetStatus.deleted ||
        asset.deletedAt === null
      ) {
        await tx.mediaAsset.update({
          where: { id: asset.id },
          data: {
            status: MediaAssetStatus.deleted,
            deletedAt: new Date(),
          },
        });
      }
      return {
        state: 'delete',
        object: {
          storageProvider: asset.storageProvider,
          bucket: asset.bucket,
          region: asset.region,
          objectKey: asset.objectKey,
        },
      };
    });
  }

  private async markCleaned(claimed: ClaimedArtifact): Promise<void> {
    const updated = await this.prisma.$transaction((tx) =>
      this.markCleanedInTransaction(tx, claimed),
    );
    if (updated !== 1) {
      this.logger.warn(
        `Lost attachment cleanup lease before completion artifact=${claimed.id}`,
      );
    }
  }

  private async markOrphanMediaCleaned(
    claimed: ClaimedOrphanMedia,
  ): Promise<void> {
    const updated = await this.prisma.$transaction((tx) =>
      this.markOrphanMediaCleanedInTransaction(tx, claimed),
    );
    if (updated !== 1) {
      this.logger.warn(
        `Lost orphan media cleanup lease before completion mediaAsset=${claimed.mediaAssetId}`,
      );
    }
  }

  private async markCleanedInTransaction(
    tx: Prisma.TransactionClient,
    claimed: ClaimedArtifact,
  ): Promise<number> {
    const updated = await tx.studioAgentArtifact.updateMany({
      where: {
        id: claimed.id,
        messageId: null,
        cleanupStatus: StudioAgentArtifactCleanupStatus.leased,
        cleanupLeaseToken: claimed.leaseToken,
        cleanupLeaseOwner: this.workerId,
      },
      data: {
        cleanupStatus: StudioAgentArtifactCleanupStatus.cleaned,
        mediaAssetId: null,
        cleanupExpiresAt: null,
        cleanupNextAttemptAt: null,
        cleanupLeaseToken: null,
        cleanupLeaseOwner: null,
        cleanupLeaseAcquiredAt: null,
        cleanupLeaseExpiresAt: null,
        cleanupCompletedAt: new Date(),
        cleanupLastErrorCode: null,
        cleanupLastErrorDetail: null,
      },
    });
    return updated.count;
  }

  private async markOrphanMediaCleanedInTransaction(
    tx: Prisma.TransactionClient,
    claimed: ClaimedOrphanMedia,
  ): Promise<number> {
    const updated = await tx.studioAgentOrphanMediaCleanupJob.updateMany({
      where: {
        id: claimed.id,
        mediaAssetId: claimed.mediaAssetId,
        status: StudioAgentArtifactCleanupStatus.leased,
        leaseToken: claimed.leaseToken,
        leaseOwner: this.workerId,
      },
      data: {
        status: StudioAgentArtifactCleanupStatus.cleaned,
        nextAttemptAt: null,
        leaseToken: null,
        leaseOwner: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
        lastErrorCode: null,
        lastErrorDetail: null,
      },
    });
    return updated.count;
  }

  /**
   * Takes over reclamation for an asset discovery has already passed. Only a
   * closed job may be revived: a live one is already the owner, and stealing
   * its schedule would reset a lease another worker holds.
   */
  private async scheduleOrphanMediaRecheck(
    tx: Prisma.TransactionClient,
    mediaAssetId: string,
  ): Promise<void> {
    const dueAt = new Date(
      Date.now() + this.config.value.attachmentCleanup.ttlMs,
    );
    await tx.$executeRaw`
      INSERT INTO "studio_agent_orphan_media_cleanup_jobs" (
        "media_asset_id",
        "status",
        "not_before",
        "next_attempt_at"
      )
      VALUES (
        ${mediaAssetId}::uuid,
        'scheduled'::"StudioAgentArtifactCleanupStatus",
        ${dueAt},
        ${dueAt}
      )
      ON CONFLICT ("media_asset_id") DO UPDATE
      SET
        "status" = 'scheduled'::"StudioAgentArtifactCleanupStatus",
        "not_before" = EXCLUDED."not_before",
        "next_attempt_at" = EXCLUDED."next_attempt_at",
        "attempt_count" = 0,
        "completed_at" = NULL,
        "last_error_code" = NULL,
        "last_error_detail" = NULL,
        "updated_at" = EXCLUDED."not_before"
      WHERE "studio_agent_orphan_media_cleanup_jobs"."status" IN (
        'cleaned'::"StudioAgentArtifactCleanupStatus",
        'dead_letter'::"StudioAgentArtifactCleanupStatus"
      )
    `;
  }

  /**
   * A live non-artifact binding has no owner of its own, so the job stays the
   * asset's watcher and re-checks after another grace period instead of
   * closing — discovery has already passed this asset and will not return.
   */
  private async deferOrphanMediaCleanupInTransaction(
    tx: Prisma.TransactionClient,
    claimed: ClaimedOrphanMedia,
  ): Promise<number> {
    const dueAt = new Date(
      Date.now() + this.config.value.attachmentCleanup.ttlMs,
    );
    const updated = await tx.studioAgentOrphanMediaCleanupJob.updateMany({
      where: {
        id: claimed.id,
        mediaAssetId: claimed.mediaAssetId,
        status: StudioAgentArtifactCleanupStatus.leased,
        leaseToken: claimed.leaseToken,
        leaseOwner: this.workerId,
      },
      data: {
        status: StudioAgentArtifactCleanupStatus.scheduled,
        notBefore: dueAt,
        nextAttemptAt: dueAt,
        attemptCount: 0,
        leaseToken: null,
        leaseOwner: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
        completedAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
      },
    });
    return updated.count;
  }

  private async recordFailure(
    claimed: ClaimedArtifact,
    cause: unknown,
  ): Promise<void> {
    const error = normalizeError(cause);
    const settings = this.config.value.attachmentCleanup;
    const terminal = claimed.attemptCount >= settings.maxAttempts;
    const retryAt = new Date(
      Date.now() +
        retryDelayMs(
          claimed.attemptCount,
          settings.retryBaseMs,
          settings.retryMaxMs,
        ),
    );
    const updated = await this.prisma.studioAgentArtifact.updateMany({
      where: {
        id: claimed.id,
        messageId: null,
        cleanupStatus: StudioAgentArtifactCleanupStatus.leased,
        cleanupLeaseToken: claimed.leaseToken,
        cleanupLeaseOwner: this.workerId,
      },
      data: {
        cleanupStatus: terminal
          ? StudioAgentArtifactCleanupStatus.dead_letter
          : StudioAgentArtifactCleanupStatus.scheduled,
        cleanupNextAttemptAt: terminal ? null : retryAt,
        cleanupLeaseToken: null,
        cleanupLeaseOwner: null,
        cleanupLeaseAcquiredAt: null,
        cleanupLeaseExpiresAt: null,
        cleanupLastErrorCode: error.code,
        cleanupLastErrorDetail: error.message,
      },
    });
    if (updated.count !== 1) return;

    const message = terminal ? 'dead-lettered' : 'retry scheduled';
    const detail = `artifact=${claimed.id} attempt=${claimed.attemptCount}/${settings.maxAttempts} code=${error.code}`;
    if (terminal) this.logger.error(`Attachment cleanup ${message} ${detail}`);
    else this.logger.warn(`Attachment cleanup ${message} ${detail}`);
  }

  private async recordOrphanMediaFailure(
    claimed: ClaimedOrphanMedia,
    cause: unknown,
  ): Promise<void> {
    const error = normalizeError(cause);
    const settings = this.config.value.attachmentCleanup;
    const terminal = claimed.attemptCount >= settings.maxAttempts;
    const retryAt = new Date(
      Date.now() +
        retryDelayMs(
          claimed.attemptCount,
          settings.retryBaseMs,
          settings.retryMaxMs,
        ),
    );
    const updated =
      await this.prisma.studioAgentOrphanMediaCleanupJob.updateMany({
        where: {
          id: claimed.id,
          mediaAssetId: claimed.mediaAssetId,
          status: StudioAgentArtifactCleanupStatus.leased,
          leaseToken: claimed.leaseToken,
          leaseOwner: this.workerId,
        },
        data: {
          status: terminal
            ? StudioAgentArtifactCleanupStatus.dead_letter
            : StudioAgentArtifactCleanupStatus.scheduled,
          nextAttemptAt: terminal ? null : retryAt,
          leaseToken: null,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          lastErrorCode: error.code,
          lastErrorDetail: error.message,
        },
      });
    if (updated.count !== 1) return;

    const message = terminal ? 'dead-lettered' : 'retry scheduled';
    const detail = `mediaAsset=${claimed.mediaAssetId} attempt=${claimed.attemptCount}/${settings.maxAttempts} code=${error.code}`;
    if (terminal)
      this.logger.error(`Orphan media cleanup ${message} ${detail}`);
    else this.logger.warn(`Orphan media cleanup ${message} ${detail}`);
  }
}

function retryDelayMs(
  attemptCount: number,
  baseMs: number,
  maxMs: number,
): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attemptCount - 1));
}

function normalizeError(cause: unknown): { code: string; message: string } {
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: unknown }).code;
    return {
      code:
        typeof code === 'string' && code.length > 0
          ? code.slice(0, 96)
          : 'STUDIO_AGENT_ATTACHMENT_CLEANUP_FAILED',
      message: cause.message.slice(0, 8_000),
    };
  }
  return {
    code: 'STUDIO_AGENT_ATTACHMENT_CLEANUP_FAILED',
    message: String(cause).slice(0, 8_000),
  };
}

function jsonStringProperty(
  value: Prisma.JsonValue,
  property: string,
): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value[property];
  return typeof candidate === 'string' ? candidate : null;
}

function isDedicatedStudioAgentAsset(asset: {
  kind: MediaAssetKind;
  source: MediaAssetSource;
  storageProvider: MediaStorageProvider;
  objectKey: string | null;
  metadata: Prisma.JsonValue;
}): boolean {
  const uploadKind = jsonStringProperty(asset.metadata, 'uploadKind');
  const isImage =
    asset.kind === MediaAssetKind.image &&
    uploadKind === STUDIO_AGENT_IMAGE_UPLOAD_KIND &&
    asset.objectKey?.includes(STUDIO_AGENT_IMAGE_FINAL_SEGMENT) === true;
  const isDocument =
    asset.kind === MediaAssetKind.document &&
    uploadKind === STUDIO_AGENT_DOCUMENT_UPLOAD_KIND &&
    asset.objectKey?.includes(STUDIO_AGENT_DOCUMENT_SEGMENT) === true;
  return (
    (isImage || isDocument) &&
    asset.source === MediaAssetSource.user_upload &&
    asset.storageProvider !== MediaStorageProvider.external_url
  );
}
