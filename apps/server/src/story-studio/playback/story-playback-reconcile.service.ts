import { backgroundTasksEnabled } from '../../common/background-tasks';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaObjectPlacementRole,
  MediaObjectPlacementStatus,
  MediaProcessingJobStatus,
  MediaProcessingJobType,
  MediaStorageProvider,
  Prisma,
  StoryAssetRole,
  type StoryBuildStatus,
} from '@prisma/client';
import {
  StoryPlaybackReconcileRunSchema,
  type StoryPlaybackExclusion,
  type StoryPlaybackReconcileResult,
  type StoryPlaybackReconcileRun,
} from '@repo/shared/story-playback';
import type Redis from 'ioredis';
import { z } from 'zod';
import { hasFeature } from '../../common/region';
import { PrismaService } from '../../infra/db/db.module';
import { REDIS } from '../../infra/redis/redis.module';
import { ImmTranscodeService } from '../../infra/storage/imm-transcode.service';
import {
  HLS_VARIANT_KEY,
  ORIGINAL_VARIANT_KEY,
} from '../../infra/storage/media-asset-placement';
import {
  JAVA_REQUEST_TIMEOUT_MS,
  JAVA_STUDIO_URL,
} from '../../integrations/java/java-config';
import { CdnPurgeProvider } from '../../media/cdn-purge.provider';
import {
  HLS_PREFIX_SCOPE,
  blockingHlsTakedownWhere,
  hlsStreamJobKey,
  retireHlsOutput,
  type HlsPrefixTakedownMetadata,
} from '../../media/hls-output';
import { errorText } from '../../media/media-action-queue.util';
import { requireModerationApproval } from '../../media/media-moderation-policy';
import { MediaProcessingService } from '../../media/media-processing.service';
import {
  isPlayableStoryBuild,
  storyManifestAccess,
  type StoryManifestAccess,
} from '../story-build-access';

/** Reconcile cadence. */
export const INTERVAL_MS = 120_000;
/**
 * Players already inside a replaced or withdrawn version keep HLS this long.
 * Like a forced offline, a free→paid switch therefore keeps reused clips' HLS
 * reachable for up to ~25 h (grace + refresh lag).
 */
export const GRACE_MS = 24 * 60 * 60_000;
/** markLive re-stamps a live output's clock at most this often. */
export const LIVE_REFRESH_MS = 60 * 60_000;
/** An output expires once its clock is older than this (grace + refresh lag). */
export const EXPIRE_AFTER_MS = GRACE_MS + LIVE_REFRESH_MS;
/**
 * Upper bound on `hls_stream` jobs pending or processing at once. A job
 * deferred behind an HLS takedown holds no slot.
 */
export const MAX_INFLIGHT = 20;
/** Outputs retired per cycle. */
export const EXPIRE_BATCH = 20;
/** The lock-holding transaction's own ceiling; the cycle deadline is shorter. */
export const CYCLE_TX_TIMEOUT_MS = 180_000;
/** Hard internal deadline of one cycle (below the 300 s ingress read timeout). */
export const CYCLE_DEADLINE_MS = 150_000;
export const CATALOGUE_PAGE_SIZE = 100;
export const CATALOGUE_MAX_PAGES = 50;
export const LOCK_KEY = 'story-playback-hls:reconcile';
export const STATE_KEY = 'story-playback-hls:state:v1';

const STATE_TIMEOUT_MS = 2_000;
const ID_CHUNK = 1_000;
const GAME_CHUNK = 500;
const ACCESS_MEMO_LIMIT = 5_000;
const CATALOGUE_PATH = '/api/player/interactive-film/games';
const BOOT_CONTEXT = 'story playback HLS';
const Uuid = z.uuid();

/** A wall-clock budget; `label` names it in the error when it runs out. */
export interface Deadline {
  at: number;
  label: string;
}

export function checkDeadline(deadline: Deadline, phase: string): void {
  if (Date.now() > deadline.at) {
    throw new Error(`${deadline.label} deadline exceeded during ${phase}`);
  }
}

/** One row of the player catalogue, as Java sent it. */
export type RawCatalogueGame = Record<string, unknown>;

/** A listed game Nest may own: UUID id plus its current version pointer. */
export interface LiveGame {
  gameId: string;
  currentVersion: string;
}

export interface LiveCatalogue {
  /** UUID games with a current version, deduplicated, in catalogue order. */
  games: LiveGame[];
  /** Every raw gameId Java listed → its current version (null if absent). */
  listed: Map<string, string | null>;
  /** Pages that added at least one new game. */
  pages: number;
  /** Distinct raw gameIds Java listed. */
  rawCount: number;
}

export interface LiveBuild {
  buildId: string;
  storyProjectId: string;
  /** Position of the build's game in the catalogue (prepare order). */
  gameOrder: number;
  chapterRank: number | null;
  storyChapterId: string | null;
  sourceRevisionId: string;
  access: StoryManifestAccess;
}

export interface LiveVersion {
  version: string;
  /** At least one playable Build backs the listed version. */
  versionResolved: boolean;
  builds: LiveBuild[];
}

const LIVE_CLIP_SELECT = Prisma.validator<Prisma.StoryBuildAssetSelect>()({
  id: true,
  buildId: true,
  rank: true,
  logicalKey: true,
  contentType: true,
  sizeBytes: true,
  width: true,
  height: true,
  durationMs: true,
  variant: { select: { variantKey: true } },
  videoClip: { select: { graphNodeId: true } },
  asset: {
    select: {
      id: true,
      storageProvider: true,
      bucket: true,
      region: true,
      objectKey: true,
      externalUrl: true,
      status: true,
      deletedAt: true,
      moderationStatus: true,
      moderationReason: true,
      sizeBytes: true,
      variants: {
        where: { variantKey: HLS_VARIANT_KEY },
        select: {
          id: true,
          variantKey: true,
          status: true,
          contentType: true,
          sizeBytes: true,
          metadata: true,
          deletedAt: true,
          placements: {
            where: {
              role: MediaObjectPlacementRole.primary,
              status: MediaObjectPlacementStatus.active,
              deletedAt: null,
            },
            orderBy: [{ priority: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              role: true,
              status: true,
              priority: true,
              storageProvider: true,
              bucket: true,
              region: true,
              objectKey: true,
              externalUrl: true,
              publicBaseUrl: true,
              deletedAt: true,
              lastVerifiedAt: true,
            },
          },
        },
      },
    },
  },
});
/** One frozen video segment of a live Build, with its asset's HLS facts. */
export type LiveClipRow = Prisma.StoryBuildAssetGetPayload<{
  select: typeof LIVE_CLIP_SELECT;
}>;

export interface LiveClipOccurrence {
  build: LiveBuild;
  row: LiveClipRow;
}

export type LiveClipHls = LiveClipRow['asset']['variants'][number];

/** One distinct live video asset and its HLS eligibility. */
export interface LiveAsset {
  assetId: string;
  asset: Omit<LiveClipRow['asset'], 'variants'>;
  hls: LiveClipHls | null;
  /** In prepare order: catalogue position, chapter, then frozen rank. */
  occurrences: LiveClipOccurrence[];
  blocked: boolean;
  /** First failed eligibility rule; null when eligible or blocked-only. */
  exclusion: StoryPlaybackExclusion | null;
  eligible: boolean;
  /** Ready HLS variant with an active primary placement. */
  hlsReady: boolean;
}

/** Rows Java sent on one catalogue page (objects only). */
export function parseCataloguePage(data: unknown): RawCatalogueGame[] {
  if (!Array.isArray(data)) {
    throw new Error('Java returned an invalid playable-story catalogue.');
  }
  return data.filter(
    (entry): entry is RawCatalogueGame =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
}

/**
 * Java's public player catalogue is the authority for what players can open:
 * reviewing, rejected and offline works are absent, and only the current
 * version of each work is listed. Rows Nest did not author (non-UUID ids) are
 * left out here.
 */
export function parseLivePlayableGames(rows: RawCatalogueGame[]): LiveGame[] {
  return rows.flatMap((row) => {
    const { gameId, currentVersion } = row;
    return typeof gameId === 'string' &&
      Uuid.safeParse(gameId).success &&
      typeof currentVersion === 'string' &&
      currentVersion.length > 0
      ? [{ gameId, currentVersion }]
      : [];
  });
}

/**
 * Distinct live video assets of the given clip rows, with each asset's
 * eligibility for HLS. Rules, first failure wins (a blocked asset is reported
 * as blocked, not excluded):
 * 1. present and `ready` (`unavailable`);
 * 2. stored in the bucket IMM reads back from (`storage_provider`);
 * 3. approved, when the cell requires approval (`moderation_pending`);
 * 4. played by a FREE Build that pins the original variant — else
 *    `pinned_rendition` (a free Build pins another variant), `paid_content`
 *    (a paid Build plays it), or `invalid_build` (manifest unreadable).
 */
export function summarizeLiveAssets(
  rows: LiveClipRow[],
  buildsById: ReadonlyMap<string, LiveBuild>,
  ossBucket: string,
  approvalRequired: boolean,
): Map<string, LiveAsset> {
  const byAsset = new Map<string, LiveClipOccurrence[]>();
  for (const row of rows) {
    const build = buildsById.get(row.buildId);
    if (!build) continue;
    const list = byAsset.get(row.asset.id) ?? [];
    list.push({ build, row });
    byAsset.set(row.asset.id, list);
  }
  const assets = new Map<string, LiveAsset>();
  for (const [assetId, occurrences] of byAsset) {
    occurrences.sort(compareOccurrences);
    const { variants, ...asset } = occurrences[0].row.asset;
    const hls = variants[0] ?? null;
    const blocked =
      asset.moderationStatus === MediaAssetModerationStatus.blocked;
    const exclusion = exclusionOf(
      asset,
      occurrences,
      ossBucket,
      approvalRequired,
    );
    assets.set(assetId, {
      assetId,
      asset,
      hls,
      occurrences,
      blocked,
      exclusion,
      eligible: !blocked && exclusion === null,
      hlsReady:
        hls !== null &&
        hls.status === MediaAssetVariantStatus.ready &&
        hls.deletedAt === null &&
        hls.placements.length > 0,
    });
  }
  return assets;
}

function exclusionOf(
  asset: LiveAsset['asset'],
  occurrences: LiveClipOccurrence[],
  ossBucket: string,
  approvalRequired: boolean,
): StoryPlaybackExclusion | null {
  if (asset.deletedAt !== null || asset.status !== MediaAssetStatus.ready) {
    return 'unavailable';
  }
  if (
    asset.storageProvider !== MediaStorageProvider.aliyun_oss ||
    !ossBucket ||
    asset.bucket !== ossBucket
  ) {
    return 'storage_provider';
  }
  if (
    approvalRequired &&
    asset.moderationStatus !== MediaAssetModerationStatus.approved &&
    asset.moderationStatus !== MediaAssetModerationStatus.blocked
  ) {
    return 'moderation_pending';
  }
  const free = occurrences.filter(
    (occurrence) => occurrence.build.access === 'free',
  );
  if (
    free.some(
      (occurrence) =>
        occurrence.row.variant.variantKey === ORIGINAL_VARIANT_KEY,
    )
  ) {
    return null;
  }
  if (free.length > 0) return 'pinned_rendition';
  if (occurrences.some((occurrence) => occurrence.build.access === 'paid')) {
    return 'paid_content';
  }
  return 'invalid_build';
}

/** Catalogue order of clips: by each clip's first occurrence. */
export function compareLiveAssets(left: LiveAsset, right: LiveAsset): number {
  return compareOccurrences(left.occurrences[0], right.occurrences[0]);
}

function compareOccurrences(
  left: LiveClipOccurrence,
  right: LiveClipOccurrence,
): number {
  return (
    left.build.gameOrder - right.build.gameOrder ||
    (left.build.chapterRank ?? 0) - (right.build.chapterRank ?? 0) ||
    left.row.rank - right.row.rank ||
    left.row.id.localeCompare(right.row.id)
  );
}

/**
 * The HLS outputs the lifecycle GC may retire now: published (`ready`), last
 * stamped live more than {@link EXPIRE_AFTER_MS} ago (an output never stamped
 * never expires), not played by IP commerce, no transcode pending or running,
 * and no takedown already emptying the prefix.
 */
export function expireWhere(now: Date): Prisma.MediaAssetVariantWhereInput {
  return {
    kind: MediaAssetVariantKind.stream,
    variantKey: HLS_VARIANT_KEY,
    status: MediaAssetVariantStatus.ready,
    deletedAt: null,
    placements: {
      some: {
        role: MediaObjectPlacementRole.primary,
        status: MediaObjectPlacementStatus.active,
        deletedAt: null,
        storageProvider: MediaStorageProvider.aliyun_oss,
        lastVerifiedAt: { lt: new Date(now.getTime() - EXPIRE_AFTER_MS) },
      },
    },
    asset: {
      is: {
        ...IP_PLAYBACK_FREE,
        processingJobs: {
          none: {
            jobType: MediaProcessingJobType.hls_stream,
            status: {
              in: [
                MediaProcessingJobStatus.pending,
                MediaProcessingJobStatus.processing,
              ],
            },
          },
        },
        moderationActions: {
          none: {
            actionType: MediaModerationActionType.delete_object,
            status: {
              in: [
                MediaModerationActionStatus.pending,
                MediaModerationActionStatus.failed,
              ],
            },
            metadata: { path: ['scope'], equals: HLS_PREFIX_SCOPE },
          },
        },
      },
    },
  };
}

/** Assets IP commerce plays as HLS outside any story: never GC'd. */
export const IP_PLAYBACK_FREE = {
  ipEpisodeMedia: { none: {} },
  ipEpisodeTrailers: { none: {} },
  ipTrailers: { none: {} },
  ipDiscoveryTrailerMedia: { none: {} },
} satisfies Prisma.MediaAssetWhereInput;

export interface StoryPlaybackState {
  lastRun: StoryPlaybackReconcileRun | null;
  lastSucceededAt: string | null;
}

/**
 * Keeps IMM HLS output on .cn equal to what players can reach. Every
 * {@link INTERVAL_MS} one pod (Postgres advisory lock) reads Java's player
 * catalogue and:
 * - prepare: queues `hls_stream` for live, eligible clips without output, at
 *   most {@link MAX_INFLIGHT} in flight;
 * - markLive: stamps `lastVerifiedAt` on the outputs of live eligible clips
 *   (the only writer of that clock);
 * - expire: retires outputs not stamped for {@link EXPIRE_AFTER_MS} and queues
 *   a durable prefix takedown (the takedown worker does the OSS/CDN I/O).
 * A catalogue failure fails the cycle before it writes anything but the
 * heartbeat, so an outage can never read as "every work went offline".
 */
@Injectable()
export class StoryPlaybackReconcileService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(StoryPlaybackReconcileService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly running = new Set<Promise<unknown>>();
  private stopped = false;
  /** Ready Builds are immutable, so their manifest access never changes. */
  private readonly accessMemo = new Map<string, StoryManifestAccess>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaProcessingService,
    private readonly imm: ImmTranscodeService,
    private readonly cdnPurge: CdnPurgeProvider,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    if (!hasFeature('adaptiveStoryPlayback')) return;
    // The cell that offers adaptive playback must be able to produce, publish
    // and take it down: refuse to boot rather than discover a gap at runtime.
    const problems: string[] = [];
    for (const assert of [
      () => this.imm.assertConfigured(BOOT_CONTEXT),
      () => this.cdnPurge.assertAliyunRefreshConfigured(BOOT_CONTEXT),
      () => {
        if (!process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS?.trim()) {
          throw new Error(
            `${BOOT_CONTEXT} requires: MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS`,
          );
        }
      },
    ]) {
      try {
        assert();
      } catch (err) {
        problems.push(errorText(err));
      }
    }
    if (problems.length > 0) throw new Error(problems.join('; '));
    if (!backgroundTasksEnabled()) return;
    if (this.stopped) return;
    this.timer = setInterval(() => {
      if (!this.stopped) void this.runCycle('schedule');
    }, INTERVAL_MS);
    this.timer.unref?.();
    this.logger.log(`Story playback reconcile running every ${INTERVAL_MS}ms`);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled([...this.running]);
  }

  /**
   * Run one cycle under the cluster-wide lock. Paused cells reject the request
   * before acquiring a lock. Otherwise, a lock miss is `already_running`; a
   * cycle failure is a `failed` run carrying the first error verbatim.
   */
  async runCycle(
    trigger: 'schedule' | 'admin',
  ): Promise<StoryPlaybackReconcileResult> {
    if (!backgroundTasksEnabled())
      throw new ConflictException(
        'Background tasks are disabled in this environment.',
      );
    const task = this.lockedCycle(trigger);
    this.running.add(task);
    try {
      return await task;
    } finally {
      this.running.delete(task);
    }
  }

  private async lockedCycle(
    trigger: 'schedule' | 'admin',
  ): Promise<StoryPlaybackReconcileResult> {
    const startedAt = new Date();
    let run: StoryPlaybackReconcileRun | null;
    // Logged only: the run contract has no field for it.
    let waitingOnTakedown = 0;
    try {
      const cycled = await this.prisma.$transaction(
        async (tx) => {
          const [lease] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
            SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})::bigint) AS "acquired"
          `;
          if (!lease?.acquired) return null;
          // The transaction only holds the lock; the cycle's own reads and
          // short write transactions run on the pool.
          return this.cycle(startedAt);
        },
        { maxWait: 5_000, timeout: CYCLE_TX_TIMEOUT_MS },
      );
      run = cycled?.run ?? null;
      waitingOnTakedown = cycled?.waitingOnTakedown ?? 0;
    } catch (err) {
      run = {
        status: 'failed',
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        error: errorText(err),
        stats: {
          cataloguePages: 0,
          catalogueGames: 0,
          enqueued: 0,
          expired: 0,
        },
      };
      await this.writeState(run);
    }
    if (!run) return { outcome: 'already_running', run: null };
    const summary = `story playback reconcile ${run.status} trigger=${trigger} pages=${run.stats.cataloguePages} games=${run.stats.catalogueGames} enqueued=${run.stats.enqueued} waitingOnTakedown=${waitingOnTakedown} expired=${run.stats.expired}`;
    if (run.status === 'succeeded') this.logger.log(summary);
    else this.logger.warn(`${summary}: ${run.error}`);
    return { outcome: 'completed', run };
  }

  private async cycle(
    startedAt: Date,
  ): Promise<{ run: StoryPlaybackReconcileRun; waitingOnTakedown: number }> {
    const deadline: Deadline = {
      at: startedAt.getTime() + CYCLE_DEADLINE_MS,
      label: 'cycle',
    };
    const now = startedAt;
    const errors: string[] = [];
    const stats = {
      cataloguePages: 0,
      catalogueGames: 0,
      enqueued: 0,
      expired: 0,
    };
    let waitingOnTakedown = 0;
    try {
      checkDeadline(deadline, 'catalogue');
      const catalogue = await this.fetchLiveGames(deadline);
      stats.cataloguePages = catalogue.pages;
      stats.catalogueGames = catalogue.rawCount;
      checkDeadline(deadline, 'live builds');
      const versions = await this.resolveLiveBuilds(catalogue.games, deadline);
      checkDeadline(deadline, 'live clips');
      const clips = await this.loadLiveAssets(
        [...versions.values()].flatMap((version) => version.builds),
        deadline,
      );
      checkDeadline(deadline, 'prepare');
      const prepared = await this.prepare(clips, now, deadline, errors);
      stats.enqueued = prepared.enqueued;
      waitingOnTakedown = prepared.waitingOnTakedown;
      checkDeadline(deadline, 'markLive');
      await this.markLive(clips, now, deadline);
      checkDeadline(deadline, 'expire');
      stats.expired = await this.expire(now, deadline, errors, clips);
    } catch (err) {
      errors.push(errorText(err));
    }
    const run: StoryPlaybackReconcileRun = {
      status: errors.length === 0 ? 'succeeded' : 'failed',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      error:
        errors.length === 0
          ? null
          : `${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`,
      stats,
    };
    await this.writeState(run);
    return { run, waitingOnTakedown };
  }

  /**
   * Read every page of Java's player catalogue. Paging stops at an empty page
   * or a page that adds no new game (Java ignoring `page`); more than
   * {@link CATALOGUE_MAX_PAGES} fails rather than act on a partial list. An
   * empty catalogue is refused: it would read as "every work went offline".
   */
  async fetchLiveGames(deadline: Deadline): Promise<LiveCatalogue> {
    const listed = new Map<string, string | null>();
    const games: LiveGame[] = [];
    let pages = 0;
    for (let page = 1; ; page += 1) {
      if (page > CATALOGUE_MAX_PAGES) {
        throw new Error(
          `Java playable-story catalogue has more than ${CATALOGUE_MAX_PAGES} pages of ${CATALOGUE_PAGE_SIZE}; refusing a partial catalogue.`,
        );
      }
      checkDeadline(deadline, `catalogue page ${page}`);
      const rows = parseCataloguePage(await this.fetchCataloguePage(page));
      if (rows.length === 0) break;
      let added = 0;
      for (const row of rows) {
        if (typeof row.gameId !== 'string' || listed.has(row.gameId)) continue;
        listed.set(
          row.gameId,
          typeof row.currentVersion === 'string' && row.currentVersion
            ? row.currentVersion
            : null,
        );
        added += 1;
      }
      if (added === 0) break;
      pages += 1;
      const seen = new Set(games.map((game) => game.gameId));
      for (const game of parseLivePlayableGames(rows)) {
        if (seen.has(game.gameId)) continue;
        seen.add(game.gameId);
        games.push(game);
      }
    }
    if (listed.size === 0) {
      throw new Error(
        'Java returned an empty playable-story catalogue; refusing to expire every work.',
      );
    }
    return { games, listed, pages, rawCount: listed.size };
  }

  private async fetchCataloguePage(page: number): Promise<unknown> {
    const url = `${JAVA_STUDIO_URL}${CATALOGUE_PATH}?page=${page}&pageSize=${CATALOGUE_PAGE_SIZE}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(JAVA_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(
        `Java playable-story catalogue request failed: ${errorText(err)}`,
      );
    }
    const body = (await response.json().catch(() => null)) as {
      code?: unknown;
      msg?: unknown;
      data?: unknown;
    } | null;
    if (!response.ok || body?.code !== 200) {
      const message =
        typeof body?.msg === 'string' && body.msg.trim()
          ? body.msg
          : body === null
            ? 'non-JSON response'
            : 'no message';
      throw new Error(
        `Java playable-story catalogue failed (HTTP ${response.status}, code ${javaCode(body?.code)}): ${message}`,
      );
    }
    return body.data;
  }

  /**
   * The playable Builds behind each listed version: a single-manifest
   * version is its Build id; a serial one is a game release of chapters.
   * Builds that are not ready or not on the current runtime schema are left
   * out — exactly as `/content` would refuse them.
   */
  async resolveLiveBuilds(
    games: LiveGame[],
    deadline: Deadline,
  ): Promise<Map<string, LiveVersion>> {
    const versions = new Map<string, LiveVersion>(
      games.map((game) => [
        game.gameId,
        { version: game.currentVersion, versionResolved: false, builds: [] },
      ]),
    );
    const gameOrder = new Map(games.map((game, index) => [game.gameId, index]));
    const candidates: Array<{
      gameId: string;
      buildId: string;
      status: StoryBuildStatus;
      runtimeSchemaVersion: number;
      sourceRevisionId: string;
      chapterRank: number | null;
      storyChapterId: string | null;
    }> = [];
    for (const batch of chunks(games, GAME_CHUNK)) {
      checkDeadline(deadline, 'live builds');
      const releases = await this.prisma.storyExperienceGameRelease.findMany({
        where: {
          OR: batch.map((game) => ({
            storyProjectId: game.gameId,
            contentVersion: game.currentVersion,
          })),
        },
        select: {
          storyProjectId: true,
          chapters: {
            orderBy: { rank: 'asc' },
            select: {
              buildId: true,
              rank: true,
              storyChapterId: true,
              build: {
                select: {
                  status: true,
                  runtimeSchemaVersion: true,
                  sourceRevisionId: true,
                },
              },
            },
          },
        },
      });
      for (const release of releases) {
        for (const chapter of release.chapters) {
          candidates.push({
            gameId: release.storyProjectId,
            buildId: chapter.buildId,
            ...chapter.build,
            chapterRank: chapter.rank,
            storyChapterId: chapter.storyChapterId,
          });
        }
      }
      const singles = batch.filter(
        (game) => Uuid.safeParse(game.currentVersion).success,
      );
      if (singles.length === 0) continue;
      const builds = await this.prisma.storyBuild.findMany({
        where: {
          OR: singles.map((game) => ({
            id: game.currentVersion,
            storyProjectId: game.gameId,
          })),
        },
        select: {
          id: true,
          storyProjectId: true,
          status: true,
          runtimeSchemaVersion: true,
          sourceRevisionId: true,
        },
      });
      for (const build of builds) {
        candidates.push({
          gameId: build.storyProjectId,
          buildId: build.id,
          status: build.status,
          runtimeSchemaVersion: build.runtimeSchemaVersion,
          sourceRevisionId: build.sourceRevisionId,
          chapterRank: null,
          storyChapterId: null,
        });
      }
    }
    const playable = candidates.filter((candidate) =>
      isPlayableStoryBuild(candidate),
    );
    const access = await this.manifestAccess(
      playable.map((candidate) => candidate.buildId),
      deadline,
    );
    for (const candidate of playable) {
      const version = versions.get(candidate.gameId);
      if (!version) continue;
      version.versionResolved = true;
      version.builds.push({
        buildId: candidate.buildId,
        storyProjectId: candidate.gameId,
        gameOrder: gameOrder.get(candidate.gameId) ?? 0,
        chapterRank: candidate.chapterRank,
        storyChapterId: candidate.storyChapterId,
        sourceRevisionId: candidate.sourceRevisionId,
        access: access.get(candidate.buildId) ?? 'invalid',
      });
    }
    return versions;
  }

  /** Manifest access per Build, reading `runtimeJson` only for new Builds. */
  private async manifestAccess(
    buildIds: string[],
    deadline: Deadline,
  ): Promise<Map<string, StoryManifestAccess>> {
    const result = new Map<string, StoryManifestAccess>();
    const unknown: string[] = [];
    for (const id of new Set(buildIds)) {
      const memo = this.accessMemo.get(id);
      if (memo) result.set(id, memo);
      else unknown.push(id);
    }
    for (const batch of chunks(unknown, ID_CHUNK)) {
      checkDeadline(deadline, 'live builds');
      const rows = await this.prisma.storyBuild.findMany({
        where: { id: { in: batch } },
        select: { id: true, runtimeJson: true },
      });
      if (this.accessMemo.size + rows.length > ACCESS_MEMO_LIMIT) {
        this.accessMemo.clear();
      }
      for (const row of rows) {
        const access = storyManifestAccess(row.runtimeJson);
        this.accessMemo.set(row.id, access);
        result.set(row.id, access);
      }
    }
    return result;
  }

  /** Frozen video segments (stills excluded) of the given Builds. */
  async loadClipRows(
    builds: LiveBuild[],
    deadline: Deadline,
  ): Promise<LiveClipRow[]> {
    const rows: LiveClipRow[] = [];
    for (const batch of chunks(
      [...new Set(builds.map((build) => build.buildId))],
      ID_CHUNK,
    )) {
      checkDeadline(deadline, 'live clips');
      rows.push(
        ...(await this.prisma.storyBuildAsset.findMany({
          where: {
            buildId: { in: batch },
            role: StoryAssetRole.video,
            asset: { is: { kind: MediaAssetKind.video } },
          },
          select: LIVE_CLIP_SELECT,
        })),
      );
    }
    return rows;
  }

  async loadLiveAssets(
    builds: LiveBuild[],
    deadline: Deadline,
  ): Promise<Map<string, LiveAsset>> {
    return summarizeLiveAssets(
      await this.loadClipRows(builds, deadline),
      new Map(builds.map((build) => [build.buildId, build])),
      this.imm.ossBucket(),
      requireModerationApproval(),
    );
  }

  /**
   * Queue transcodes for live eligible clips without a ready output, in
   * catalogue order. A missing job is created; a `cancelled` or `completed`
   * one is restarted. `pending`/`processing` are in flight, `failed` is
   * retrying, `dead` waits for an operator — all left alone. A clip whose
   * prefix an HLS takedown still blocks (running, or completed within the CDN
   * settle window) waits for a later cycle: the worker would only defer its
   * job, which then holds no slot.
   */
  private async prepare(
    clips: Map<string, LiveAsset>,
    now: Date,
    deadline: Deadline,
    errors: string[],
  ): Promise<{ enqueued: number; waitingOnTakedown: number }> {
    const candidates = [...clips.values()]
      .filter((clip) => clip.eligible && !clip.hlsReady)
      .sort(compareLiveAssets);
    if (candidates.length === 0) return { enqueued: 0, waitingOnTakedown: 0 };
    const jobs = new Map<string, MediaProcessingJobStatus>();
    const waiting = new Set<string>();
    for (const batch of chunks(candidates, ID_CHUNK)) {
      checkDeadline(deadline, 'prepare');
      const rows = await this.prisma.mediaProcessingJob.findMany({
        where: {
          idempotencyKey: {
            in: batch.map((clip) => hlsStreamJobKey(clip.assetId)),
          },
        },
        select: { idempotencyKey: true, status: true },
      });
      for (const row of rows) {
        if (row.idempotencyKey) jobs.set(row.idempotencyKey, row.status);
      }
      const takedowns = await this.prisma.mediaModerationAction.findMany({
        where: blockingHlsTakedownWhere(
          { in: batch.map((clip) => clip.assetId) },
          now,
        ),
        select: { assetId: true },
      });
      for (const takedown of takedowns) waiting.add(takedown.assetId);
    }
    const inflight = await this.prisma.mediaProcessingJob.count({
      where: {
        jobType: MediaProcessingJobType.hls_stream,
        status: {
          in: [
            MediaProcessingJobStatus.pending,
            MediaProcessingJobStatus.processing,
          ],
        },
        // A job the worker deferred behind a takedown holds no IMM slot.
        output: { path: ['deferredByTakedown'], equals: Prisma.AnyNull },
      },
    });
    let budget = MAX_INFLIGHT - inflight;
    let enqueued = 0;
    for (const clip of candidates) {
      if (budget <= 0) break;
      if (waiting.has(clip.assetId)) continue;
      const idempotencyKey = hlsStreamJobKey(clip.assetId);
      const status = jobs.get(idempotencyKey);
      const restart =
        status === MediaProcessingJobStatus.cancelled ||
        status === MediaProcessingJobStatus.completed;
      if (status !== undefined && !restart) continue;
      checkDeadline(deadline, 'prepare');
      const input = {
        assetId: clip.assetId,
        jobType: MediaProcessingJobType.hls_stream,
        priority: 50,
        idempotencyKey,
      };
      try {
        if (restart) {
          await this.prisma.$transaction((tx) =>
            this.media.enqueueJobTx(input, tx, true),
          );
        } else {
          await this.media.enqueueJob(input);
        }
        enqueued += 1;
        budget -= 1;
      } catch (err) {
        // Someone else restarted or claimed it first: nothing to do.
        if (err instanceof ConflictException) continue;
        errors.push(`enqueue ${clip.assetId}: ${errorText(err)}`);
      }
    }
    return { enqueued, waitingOnTakedown: waiting.size };
  }

  /** Stamp the clock of every live eligible output not stamped this hour. */
  private async markLive(
    clips: Map<string, LiveAsset>,
    now: Date,
    deadline: Deadline,
  ): Promise<void> {
    const ids = [...clips.values()]
      .filter((clip) => clip.eligible && clip.hlsReady)
      .map((clip) => clip.assetId);
    for (const batch of chunks(ids, ID_CHUNK)) {
      checkDeadline(deadline, 'markLive');
      await this.prisma.mediaObjectPlacement.updateMany({
        where: {
          assetId: { in: batch },
          role: MediaObjectPlacementRole.primary,
          storageProvider: MediaStorageProvider.aliyun_oss,
          status: MediaObjectPlacementStatus.active,
          deletedAt: null,
          variant: {
            is: {
              variantKey: HLS_VARIANT_KEY,
              status: MediaAssetVariantStatus.ready,
              deletedAt: null,
            },
          },
          OR: [
            { lastVerifiedAt: null },
            {
              lastVerifiedAt: { lt: new Date(now.getTime() - LIVE_REFRESH_MS) },
            },
          ],
        },
        data: { lastVerifiedAt: now },
      });
    }
  }

  /**
   * Retire up to {@link EXPIRE_BATCH} expired outputs. Each one is a short
   * transaction: re-check it still qualifies, CAS the variant off `ready`,
   * and queue the durable prefix takedown with the published keys — no OSS
   * or CDN call happens here. A clip live and eligible in this cycle is never
   * retired: its output can only look stale because it was republished after
   * the clips were loaded (a failed output keeps its old clock), and the next
   * markLive stamps it.
   */
  private async expire(
    now: Date,
    deadline: Deadline,
    errors: string[],
    live: Map<string, LiveAsset>,
  ): Promise<number> {
    const rows = await this.prisma.mediaAssetVariant.findMany({
      where: expireWhere(now),
      orderBy: { createdAt: 'asc' },
      take: EXPIRE_BATCH,
      select: { id: true, assetId: true },
    });
    let expired = 0;
    for (const row of rows) {
      if (live.get(row.assetId)?.eligible) continue;
      checkDeadline(deadline, 'expire');
      try {
        const retired = await this.prisma.$transaction(async (tx) => {
          const current = await tx.mediaAssetVariant.findFirst({
            where: { id: row.id, ...expireWhere(now) },
            select: {
              id: true,
              assetId: true,
              asset: { select: { bucket: true, region: true } },
              // Every row, retired ones included: rows are never hard-deleted,
              // so this is every key the variant ever published.
              placements: {
                select: {
                  objectKey: true,
                  role: true,
                  status: true,
                  storageProvider: true,
                  lastVerifiedAt: true,
                  deletedAt: true,
                },
              },
            },
          });
          if (!current) return false; // lost a race: re-stamped or busy
          const verifiedAt = current.placements
            .filter(
              (placement) =>
                placement.role === MediaObjectPlacementRole.primary &&
                placement.status === MediaObjectPlacementStatus.active &&
                placement.deletedAt === null &&
                placement.storageProvider === MediaStorageProvider.aliyun_oss,
            )
            .map((placement) => placement.lastVerifiedAt)
            .filter((value): value is Date => value !== null)
            .sort((left, right) => left.getTime() - right.getTime())[0];
          const bucket = current.asset.bucket;
          if (!bucket || !verifiedAt) {
            throw new Error(
              `HLS output ${current.id} has no bucket or liveness stamp to expire.`,
            );
          }
          const refreshKeys = current.placements.flatMap((placement) =>
            placement.objectKey ? [placement.objectKey] : [],
          );
          const changed = await retireHlsOutput(tx, {
            assetId: current.assetId,
            variantId: current.id,
            fromStatuses: [MediaAssetVariantStatus.ready],
            now,
          });
          if (!changed) return false;
          const metadata: HlsPrefixTakedownMetadata = {
            scope: HLS_PREFIX_SCOPE,
            origin: 'lifecycle',
            bucket,
            region: current.asset.region,
            prefix: `hls/${current.assetId}/`,
            refreshKeys,
          };
          await tx.mediaModerationAction.create({
            data: {
              caseId: null,
              assetId: current.assetId,
              variantId: current.id,
              actionType: MediaModerationActionType.delete_object,
              status: MediaModerationActionStatus.pending,
              reason: 'story_playback_lifecycle',
              provider: MediaStorageProvider.aliyun_oss,
              idempotencyKey: `media-hls-gc:${current.id}:${verifiedAt.getTime()}`,
              metadata: { ...metadata },
            },
          });
          return true;
        });
        if (retired) expired += 1;
      } catch (err) {
        errors.push(`expire ${row.assetId}: ${errorText(err)}`);
      }
    }
    return expired;
  }

  /** The last heartbeat, time-boxed; an unreadable state reports why. */
  async readState(): Promise<{
    state: StoryPlaybackState | null;
    error: string | null;
  }> {
    try {
      const fields = await withTimeout(
        this.redis.hgetall(STATE_KEY),
        STATE_TIMEOUT_MS,
        `Redis HGETALL ${STATE_KEY}`,
      );
      const lastRun = fields.lastRun
        ? StoryPlaybackReconcileRunSchema.parse(JSON.parse(fields.lastRun))
        : null;
      const lastSucceededAt = fields.lastSucceededAt
        ? z.iso.datetime().parse(fields.lastSucceededAt)
        : null;
      return { state: { lastRun, lastSucceededAt }, error: null };
    } catch (err) {
      return { state: null, error: errorText(err) };
    }
  }

  /**
   * One heartbeat write per cycle. `lastSucceededAt` is only ever advanced, so
   * a failed run never erases the last success.
   */
  private async writeState(run: StoryPlaybackReconcileRun): Promise<void> {
    const fields: Record<string, string> = { lastRun: JSON.stringify(run) };
    if (run.status === 'succeeded') fields.lastSucceededAt = run.finishedAt;
    try {
      await withTimeout(
        this.redis.hset(STATE_KEY, fields),
        STATE_TIMEOUT_MS,
        `Redis HSET ${STATE_KEY}`,
      );
    } catch (err) {
      this.logger.warn(
        `story playback heartbeat write failed: ${errorText(err)}`,
      );
    }
  }
}

/** Java's envelope `code` as sent (normally a number), for error text. */
function javaCode(value: unknown): string {
  if (value === undefined || value === null) return 'none';
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : JSON.stringify(value);
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}
