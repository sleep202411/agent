import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaObjectPlacementRole,
  MediaObjectPlacementStatus,
  MediaProcessingJobStatus,
  MediaStorageProvider,
  Prisma,
  StoryAssetRole,
} from '@prisma/client';
import {
  StoryPlaybackRenditionNameSchema,
  type StoryPlaybackClip,
  type StoryPlaybackClipState,
  type StoryPlaybackGame,
  type StoryPlaybackOverview,
  type StoryPlaybackReconcileResult,
  type StoryPlaybackRetryFailedResult,
  type StoryPlaybackTakedown,
} from '@repo/shared/story-playback';
import { z } from 'zod';
import { hasFeature } from '../../common/region';
import { PrismaService } from '../../infra/db/db.module';
import {
  IMM_HLS_LADDER,
  ImmTranscodeService,
} from '../../infra/storage/imm-transcode.service';
import { HLS_VARIANT_KEY } from '../../infra/storage/media-asset-placement';
import {
  HLS_PREFIX_SCOPE,
  hlsStreamJobKey,
  parseHlsPrefixTakedownMetadata,
  storyHlsPlayback,
  transcodeMayStillWrite,
} from '../../media/hls-output';
import { errorText, isJsonObject } from '../../media/media-action-queue.util';
import { MediaProcessingService } from '../../media/media-processing.service';
import { requireModerationApproval } from '../../media/media-moderation-policy';
import type { StoryPlaybackOverviewQuery } from './story-playback.dto';
import {
  EXPIRE_AFTER_MS,
  GRACE_MS,
  INTERVAL_MS,
  IP_PLAYBACK_FREE,
  LIVE_REFRESH_MS,
  StoryPlaybackReconcileService,
  compareLiveAssets,
  summarizeLiveAssets,
  type Deadline,
  type LiveAsset,
  type LiveBuild,
  type LiveCatalogue,
  type LiveClipRow,
  type LiveVersion,
} from './story-playback-reconcile.service';

const logger = new Logger('StoryPlaybackAdminService');
/** Budget of one admin read (admin-ui gives up after 15 s). */
const ADMIN_DEADLINE_MS = 12_000;
/** Budget of retry-failed's clip loop (the ingress read timeout is 300 s). */
const RETRY_BUDGET_MS = 90_000;
/** An output no live work re-stamped within this window will be GC'd. */
const UNREFRESHED_AFTER_MS = LIVE_REFRESH_MS + 2 * INTERVAL_MS;
const ID_CHUNK = 1_000;
const Uuid = z.uuid();

type JobRow = Prisma.MediaProcessingJobGetPayload<{
  select: typeof JOB_SELECT;
}>;
const JOB_SELECT = Prisma.validator<Prisma.MediaProcessingJobSelect>()({
  id: true,
  idempotencyKey: true,
  status: true,
  attempt: true,
  maxAttempts: true,
  output: true,
  errorMessage: true,
  completedAt: true,
  nextAttemptAt: true,
});

type TakedownRow = Prisma.MediaModerationActionGetPayload<{
  select: typeof TAKEDOWN_SELECT;
}>;
const TAKEDOWN_SELECT = Prisma.validator<Prisma.MediaModerationActionSelect>()({
  id: true,
  assetId: true,
  status: true,
  attempt: true,
  nextAttemptAt: true,
  completedAt: true,
  errorMessage: true,
  metadata: true,
  createdAt: true,
});

/**
 * Admin read and operations surface of .cn interactive-film HLS: per-work
 * transcode coverage against the live player catalogue, the clip-level
 * detail, the cleanup queue, the reconcile heartbeat, and the two operator
 * actions (retry failed clips, reconcile now).
 */
@Injectable()
export class StoryPlaybackAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconcile: StoryPlaybackReconcileService,
    private readonly media: MediaProcessingService,
    private readonly imm: ImmTranscodeService,
  ) {}

  async overview(
    query: StoryPlaybackOverviewQuery,
  ): Promise<StoryPlaybackOverview> {
    requireEnabled();
    const now = new Date();
    return adminRead(now, (deadline) =>
      this.readOverview(query, now, deadline),
    );
  }

  /**
   * Restart the failed (`dead`) and retrying (`failed`) transcodes of a live
   * work. IMM is asked only while the job's task could still write the prefix
   * ({@link transcodeMayStillWrite}): a task still running is refused, since
   * restarting would submit a second task onto the same prefix. A clip that
   * cannot be restarted is refused with the verbatim reason, as is every clip
   * not reached within {@link RETRY_BUDGET_MS}, so the answer (and its audit)
   * always arrives. Any failure other than a deliberate HTTP refusal is also
   * logged with its stack.
   */
  async retryFailed(gameId: string): Promise<StoryPlaybackRetryFailedResult> {
    requireEnabled();
    const { version, targets } = await adminRead(new Date(), (deadline) =>
      this.retryTargets(gameId, deadline),
    );
    const requeued: StoryPlaybackRetryFailedResult['requeued'] = [];
    const refused: StoryPlaybackRetryFailedResult['refused'] = [];
    const budgetAt = Date.now() + RETRY_BUDGET_MS;
    for (const [index, { assetId, job }] of targets.entries()) {
      if (Date.now() > budgetAt) {
        const reason = `not attempted: retry time budget exhausted after ${index} of ${targets.length} clips; press retry again.`;
        for (const target of targets.slice(index)) {
          refused.push({ assetId: target.assetId, reason });
        }
        break;
      }
      const immTaskId = jobOutput(job).immTaskId;
      try {
        if (immTaskId && transcodeMayStillWrite(job, Date.now())) {
          const status = await this.imm.getTaskStatus(immTaskId);
          if (status.state === 'running') {
            refused.push({
              assetId,
              reason: `IMM task ${immTaskId} is still running (${status.raw}); retry after it finishes.`,
            });
            continue;
          }
        }
        const retried = await this.media.retryJob(job.id);
        requeued.push({ assetId, jobId: retried.id });
      } catch (err) {
        const reason = errorText(err);
        if (!(err instanceof HttpException)) {
          logger.error(`Retry of clip ${assetId} failed: ${reason}`, err);
        }
        refused.push({ assetId, reason });
      }
    }
    return { gameId, version, requeued, refused };
  }

  reconcileNow(): Promise<StoryPlaybackReconcileResult> {
    requireEnabled();
    return this.reconcile.runCycle('admin');
  }

  private async readOverview(
    query: StoryPlaybackOverviewQuery,
    now: Date,
    deadline: Deadline,
  ): Promise<StoryPlaybackOverview> {
    const [catalogue, state] = await Promise.all([
      this.catalogue(deadline),
      this.reconcile.readState(),
    ]);
    const includeClips = query.include === 'clips';

    const managed = await this.managedGameIds(query.gameIds);
    const listedGames = query.gameIds.flatMap((gameId) => {
      const version = catalogue.listed.get(gameId);
      return managed.has(gameId) && version
        ? [{ gameId, currentVersion: version }]
        : [];
    });
    const versions = await this.reconcile.resolveLiveBuilds(
      listedGames,
      deadline,
    );
    const builds = [...versions.values()].flatMap((version) => version.builds);
    const clipsByGame = this.clipsByGame(
      versions,
      await this.reconcile.loadClipRows(builds, deadline),
    );
    const allClips = [...clipsByGame.values()].flatMap((clips) => [
      ...clips.values(),
    ]);
    const jobs = await this.loadJobs(allClips.map((clip) => clip.assetId));
    const takedowns = await this.latestModerationTakedowns(
      allClips.filter((clip) => clip.blocked).map((clip) => clip.assetId),
    );
    const cleanup = await this.cleanup(
      [...managed],
      clipsByGame,
      catalogue,
      now,
    );
    const labels: ClipLabels = includeClips
      ? await this.clipLabels(builds)
      : { scenes: new Map(), chapters: new Map() };

    const games = query.gameIds.map((gameId): StoryPlaybackGame => {
      const listed = catalogue.listed.has(gameId);
      const version = versions.get(gameId);
      const clips = clipsByGame.get(gameId);
      const states = [...(clips?.values() ?? [])]
        .sort(compareLiveAssets)
        .map((clip) => ({
          clip,
          state: clipState(clip, jobs.get(clip.assetId) ?? null),
        }));
      const gameCleanup = cleanup.get(gameId);
      return {
        gameId,
        managed: managed.has(gameId),
        catalogue: {
          listed,
          version: catalogue.listed.get(gameId) ?? null,
          versionResolved: version?.versionResolved ?? false,
        },
        summary: listed && version?.versionResolved ? summarize(states) : null,
        cleanup: {
          pending: gameCleanup?.pending ?? 0,
          nextAt: gameCleanup?.nextAt ?? null,
          items: includeClips ? (gameCleanup?.items ?? []) : null,
        },
        clips: includeClips
          ? states.map(({ clip, state }) =>
              toClip(clip, state, jobs.get(clip.assetId) ?? null, {
                takedown: takedowns.get(clip.assetId) ?? null,
                labels,
              }),
            )
          : null,
      };
    });

    const lastSucceededAt = state.state?.lastSucceededAt ?? null;
    return {
      generatedAt: now.toISOString(),
      renditionLadder: IMM_HLS_LADDER.map((tier) => tier.name),
      reconciler: {
        intervalSeconds: INTERVAL_MS / 1000,
        graceHours: GRACE_MS / (60 * 60_000),
        stale:
          lastSucceededAt === null ||
          Date.parse(lastSucceededAt) < now.getTime() - 3 * INTERVAL_MS ||
          state.error !== null,
        lastRun: state.state?.lastRun ?? null,
        lastSucceededAt,
        stateError: state.error,
      },
      games,
    };
  }

  /** The listed work's version and its failed or retrying clips, in order. */
  private async retryTargets(
    gameId: string,
    deadline: Deadline,
  ): Promise<{
    version: string;
    targets: Array<{ assetId: string; job: JobRow }>;
  }> {
    const catalogue = await this.catalogue(deadline);
    const game = catalogue.games.find((entry) => entry.gameId === gameId);
    if (!game) {
      throw new NotFoundException({
        code: 'STORY_PLAYBACK_GAME_NOT_LISTED',
        msg: '该作品不在玩家目录中（未上线或已下线），无法重试转码。',
      });
    }
    const versions = await this.reconcile.resolveLiveBuilds([game], deadline);
    const clips = await this.reconcile.loadLiveAssets(
      versions.get(gameId)?.builds ?? [],
      deadline,
    );
    const jobs = await this.loadJobs([...clips.keys()]);
    const targets = [...clips.values()]
      .sort(compareLiveAssets)
      .flatMap((clip) => {
        const job = jobs.get(clip.assetId) ?? null;
        const state = clipState(clip, job);
        return job && (state === 'failed' || state === 'retrying')
          ? [{ assetId: clip.assetId, job }]
          : [];
      });
    return { version: game.currentVersion, targets };
  }

  private async catalogue(deadline: Deadline): Promise<LiveCatalogue> {
    try {
      return await this.reconcile.fetchLiveGames(deadline);
    } catch (err) {
      throw new BadGatewayException({
        code: 'JAVA_CATALOGUE_FAILED',
        msg: errorText(err),
      });
    }
  }

  /** Requested ids that are Story Studio projects (UUID with a project row). */
  private async managedGameIds(gameIds: string[]): Promise<Set<string>> {
    const ids = gameIds.filter((id) => Uuid.safeParse(id).success);
    if (ids.length === 0) return new Set();
    const projects = await this.prisma.storyProject.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return new Set(projects.map((project) => project.id));
  }

  /** Eligibility is per work: an asset shared by two works is judged in each. */
  private clipsByGame(
    versions: Map<string, LiveVersion>,
    rows: LiveClipRow[],
  ): Map<string, Map<string, LiveAsset>> {
    const ossBucket = this.imm.ossBucket();
    const approvalRequired = requireModerationApproval();
    const result = new Map<string, Map<string, LiveAsset>>();
    for (const [gameId, version] of versions) {
      if (!version.versionResolved) continue;
      const buildsById = new Map<string, LiveBuild>(
        version.builds.map((build) => [build.buildId, build]),
      );
      result.set(
        gameId,
        summarizeLiveAssets(
          rows.filter((row) => buildsById.has(row.buildId)),
          buildsById,
          ossBucket,
          approvalRequired,
        ),
      );
    }
    return result;
  }

  /** Each asset's canonical `hls_stream` job, keyed by asset id. */
  private async loadJobs(assetIds: string[]): Promise<Map<string, JobRow>> {
    const jobs = new Map<string, JobRow>();
    for (const batch of chunks([...new Set(assetIds)], ID_CHUNK)) {
      const assetByKey = new Map(
        batch.map((assetId) => [hlsStreamJobKey(assetId), assetId]),
      );
      const rows = await this.prisma.mediaProcessingJob.findMany({
        where: { idempotencyKey: { in: [...assetByKey.keys()] } },
        select: JOB_SELECT,
      });
      for (const row of rows) {
        const assetId = row.idempotencyKey
          ? assetByKey.get(row.idempotencyKey)
          : undefined;
        if (assetId) jobs.set(assetId, row);
      }
    }
    return jobs;
  }

  /** The latest moderation-origin HLS takedown of each blocked clip. */
  private async latestModerationTakedowns(
    assetIds: string[],
  ): Promise<Map<string, StoryPlaybackTakedown>> {
    const result = new Map<string, StoryPlaybackTakedown>();
    for (const batch of chunks(assetIds, ID_CHUNK)) {
      const rows = await this.prisma.mediaModerationAction.findMany({
        where: {
          assetId: { in: batch },
          actionType: MediaModerationActionType.delete_object,
          AND: [
            { metadata: { path: ['scope'], equals: HLS_PREFIX_SCOPE } },
            { metadata: { path: ['origin'], equals: 'moderation' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: TAKEDOWN_SELECT,
      });
      for (const row of rows) {
        if (result.has(row.assetId)) continue;
        const takedown = toTakedown(row);
        if (takedown) result.set(row.assetId, takedown);
      }
    }
    return result;
  }

  /**
   * Per managed work: outputs the GC will retire (`scheduled`: published, no
   * longer re-stamped by any live work, at `lastVerifiedAt + 25 h`) and
   * outputs it is retiring now (`cleaning`: lifecycle takedowns in progress).
   */
  private async cleanup(
    gameIds: string[],
    clipsByGame: Map<string, Map<string, LiveAsset>>,
    catalogue: LiveCatalogue,
    now: Date,
  ): Promise<Map<string, GameCleanup>> {
    const result = new Map<string, GameCleanup>();
    if (gameIds.length === 0) return result;
    const inGames = {
      storyBuildAssets: {
        some: { storyProjectId: { in: gameIds }, role: StoryAssetRole.video },
      },
    } satisfies Prisma.MediaAssetWhereInput;
    const gamesOf = {
      storyBuildAssets: {
        where: { storyProjectId: { in: gameIds }, role: StoryAssetRole.video },
        select: { storyProjectId: true },
      },
    } satisfies Prisma.MediaAssetSelect;

    const scheduled = await this.prisma.mediaAssetVariant.findMany({
      where: {
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
            lastVerifiedAt: {
              lt: new Date(now.getTime() - UNREFRESHED_AFTER_MS),
            },
          },
        },
        asset: { is: { ...IP_PLAYBACK_FREE, ...inGames } },
      },
      select: {
        assetId: true,
        sizeBytes: true,
        placements: {
          where: {
            role: MediaObjectPlacementRole.primary,
            status: MediaObjectPlacementStatus.active,
            deletedAt: null,
            lastVerifiedAt: { not: null },
          },
          select: { lastVerifiedAt: true },
        },
        asset: { select: gamesOf },
      },
    });
    const cleaning = await this.prisma.mediaModerationAction.findMany({
      where: {
        actionType: MediaModerationActionType.delete_object,
        status: {
          in: [
            MediaModerationActionStatus.pending,
            MediaModerationActionStatus.failed,
          ],
        },
        AND: [
          { metadata: { path: ['scope'], equals: HLS_PREFIX_SCOPE } },
          { metadata: { path: ['origin'], equals: 'lifecycle' } },
        ],
        asset: { is: inGames },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        ...TAKEDOWN_SELECT,
        variant: { select: { sizeBytes: true } },
        asset: { select: gamesOf },
      },
    });

    for (const gameId of gameIds) {
      const live = new Set(
        [...(clipsByGame.get(gameId)?.values() ?? [])]
          .filter((clip) => clip.eligible)
          .map((clip) => clip.assetId),
      );
      const reason = catalogue.listed.has(gameId) ? 'replaced' : 'offline';
      const items: NonNullable<StoryPlaybackGame['cleanup']['items']> = [];
      for (const variant of scheduled) {
        if (
          live.has(variant.assetId) ||
          !variant.asset.storyBuildAssets.some(
            (row) => row.storyProjectId === gameId,
          )
        ) {
          continue;
        }
        const verifiedAt = variant.placements
          .map((placement) => placement.lastVerifiedAt)
          .filter((value): value is Date => value !== null)
          .sort((left, right) => left.getTime() - right.getTime())[0];
        if (!verifiedAt) continue;
        items.push({
          assetId: variant.assetId,
          reason,
          state: 'scheduled',
          scheduledAt: new Date(
            verifiedAt.getTime() + EXPIRE_AFTER_MS,
          ).toISOString(),
          outputBytes: variant.sizeBytes?.toString() ?? null,
          takedown: null,
        });
      }
      for (const action of cleaning) {
        if (
          !action.asset.storyBuildAssets.some(
            (row) => row.storyProjectId === gameId,
          )
        ) {
          continue;
        }
        items.push({
          assetId: action.assetId,
          reason,
          state: 'cleaning',
          scheduledAt: null,
          outputBytes: action.variant?.sizeBytes?.toString() ?? null,
          takedown: toTakedown(action),
        });
      }
      const nextAt =
        items
          .flatMap((item) => (item.scheduledAt ? [item.scheduledAt] : []))
          .sort()[0] ?? null;
      result.set(gameId, { pending: items.length, nextAt, items });
    }
    return result;
  }

  /** Scene names from each Build's source revision, and current chapter titles. */
  private async clipLabels(builds: LiveBuild[]): Promise<ClipLabels> {
    const revisionIds = [
      ...new Set(builds.map((build) => build.sourceRevisionId)),
    ];
    const chapterIds = [
      ...new Set(
        builds.flatMap((build) =>
          build.storyChapterId ? [build.storyChapterId] : [],
        ),
      ),
    ];
    const revisions = revisionIds.length
      ? await this.prisma.storyRevision.findMany({
          where: { id: { in: revisionIds } },
          select: { id: true, content: true },
        })
      : [];
    const chapters = chapterIds.length
      ? await this.prisma.storyChapter.findMany({
          where: { id: { in: chapterIds } },
          select: { id: true, title: true },
        })
      : [];
    return {
      scenes: new Map(
        revisions.map((revision) => [
          revision.id,
          sceneNames(revision.content),
        ]),
      ),
      chapters: new Map(chapters.map((chapter) => [chapter.id, chapter.title])),
    };
  }
}

interface GameCleanup {
  pending: number;
  /** Earliest scheduled retirement. */
  nextAt: string | null;
  items: NonNullable<StoryPlaybackGame['cleanup']['items']>;
}

interface ClipLabels {
  /** sourceRevisionId → draft nodeId → display label. */
  scenes: Map<string, Map<string, string>>;
  /** storyChapterId → current title. */
  chapters: Map<string, string>;
}

function requireEnabled(): void {
  if (!hasFeature('adaptiveStoryPlayback')) {
    throw new NotFoundException({
      code: 'STORY_PLAYBACK_HLS_DISABLED',
      msg: '播放分发（HLS）仅在中国站启用。',
    });
  }
}

/**
 * Run one admin read under {@link ADMIN_DEADLINE_MS} and let its failure reach
 * the operator verbatim: HTTP errors pass through; any other error is a 504
 * once the budget is spent (checkDeadline throws a plain Error), else a 500.
 * The exception filter logs no HttpException, so the original error is logged
 * here: a 500 with its stack, an expected 504 as a warning.
 */
async function adminRead<T>(
  now: Date,
  read: (deadline: Deadline) => Promise<T>,
): Promise<T> {
  const deadline: Deadline = {
    at: now.getTime() + ADMIN_DEADLINE_MS,
    label: 'request',
  };
  try {
    return await read(deadline);
  } catch (err) {
    if (err instanceof HttpException) throw err;
    const msg = errorText(err);
    if (Date.now() > deadline.at) {
      logger.warn(`Admin read overran its deadline: ${msg}`);
      throw new GatewayTimeoutException({
        code: 'STORY_PLAYBACK_REQUEST_DEADLINE',
        msg,
      });
    }
    logger.error(`Admin read failed: ${msg}`, err);
    throw new InternalServerErrorException({
      code: 'STORY_PLAYBACK_READ_FAILED',
      msg,
    });
  }
}

/**
 * Display state of a clip, first match wins: blocked, excluded, ready, then
 * the transcode job — processing (claimed, or between polls of a live IMM
 * task), queued, retrying (`failed`), failed (`dead`), else not queued (no
 * job, cancelled, or completed without a ready output).
 */
export function clipState(
  clip: LiveAsset,
  job: Pick<JobRow, 'status' | 'output'> | null,
): StoryPlaybackClipState {
  if (clip.blocked) return 'blocked';
  if (clip.exclusion) return 'excluded';
  if (clip.hlsReady) return 'ready';
  switch (job?.status) {
    case MediaProcessingJobStatus.processing:
      return 'processing';
    case MediaProcessingJobStatus.pending:
      return jobOutput(job).immTaskId ? 'processing' : 'queued';
    case MediaProcessingJobStatus.failed:
      return 'retrying';
    case MediaProcessingJobStatus.dead:
      return 'failed';
    default:
      return 'not_queued';
  }
}

function summarize(
  states: Array<{ state: StoryPlaybackClipState }>,
): NonNullable<StoryPlaybackGame['summary']> {
  const count = (state: StoryPlaybackClipState) =>
    states.filter((entry) => entry.state === state).length;
  const blocked = count('blocked');
  const excluded = count('excluded');
  return {
    total: states.length,
    eligible: states.length - blocked - excluded,
    ready: count('ready'),
    queued: count('queued'),
    processing: count('processing'),
    retrying: count('retrying'),
    failed: count('failed'),
    notQueued: count('not_queued'),
    blocked,
    excluded,
  };
}

function toClip(
  clip: LiveAsset,
  state: StoryPlaybackClipState,
  job: JobRow | null,
  context: { takedown: StoryPlaybackTakedown | null; labels: ClipLabels },
): StoryPlaybackClip {
  const first = clip.occurrences[0].row;
  const readyHls = state === 'ready' ? clip.hls : null;
  return {
    assetId: clip.assetId,
    occurrences: clip.occurrences.map(({ build, row }) => {
      const sceneId = row.videoClip?.graphNodeId ?? row.logicalKey;
      return {
        buildId: build.buildId,
        chapterRank: build.chapterRank,
        chapterTitle: build.storyChapterId
          ? (context.labels.chapters.get(build.storyChapterId) ?? null)
          : null,
        sceneId,
        sceneLabel:
          context.labels.scenes.get(build.sourceRevisionId)?.get(sceneId) ??
          sceneId,
        clipIndex: (row.rank % 1000) + 1,
        logicalKey: row.logicalKey,
      };
    }),
    durationMs: nonNegativeIntOrNull(first.durationMs),
    source: {
      contentType: first.contentType,
      sizeBytes: (first.sizeBytes ?? clip.asset.sizeBytes)?.toString() ?? null,
      width: positiveIntOrNull(first.width),
      height: positiveIntOrNull(first.height),
    },
    moderation: {
      status: clip.asset.moderationStatus,
      reason: clip.asset.moderationReason,
      takedown: context.takedown,
    },
    hls: {
      state,
      exclusion: state === 'excluded' ? clip.exclusion : null,
      renditions: readyHls ? renditionsOf(readyHls.metadata) : [],
      outputBytes:
        clip.hls &&
        (clip.hls.status === MediaAssetVariantStatus.ready ||
          clip.hls.status === MediaAssetVariantStatus.blocked)
          ? (clip.hls.sizeBytes?.toString() ?? null)
          : null,
      job: job ? toJob(job) : null,
      playback: readyHls ? storyHlsPlayback(clip.asset, readyHls) : null,
    },
  };
}

function toJob(job: JobRow): NonNullable<StoryPlaybackClip['hls']['job']> {
  const output = jobOutput(job);
  const completedAt = job.completedAt?.toISOString() ?? null;
  return {
    id: job.id,
    status: job.status,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    immTaskId: output.immTaskId,
    submittedAt: output.submittedAt,
    completedAt,
    nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
    transcodeSeconds:
      completedAt && output.submittedAt
        ? Math.max(
            0,
            (Date.parse(completedAt) - Date.parse(output.submittedAt)) / 1000,
          )
        : null,
    error: job.errorMessage,
  };
}

function jobOutput(job: Pick<JobRow, 'output'>): {
  immTaskId: string | null;
  submittedAt: string | null;
} {
  const output = isJsonObject(job.output) ? job.output : {};
  return {
    immTaskId:
      typeof output.immTaskId === 'string' && output.immTaskId
        ? output.immTaskId
        : null,
    submittedAt: isoOrNull(output.submittedAt),
  };
}

function toTakedown(row: TakedownRow): StoryPlaybackTakedown | null {
  const meta = parseHlsPrefixTakedownMetadata(row.metadata);
  if (
    !meta ||
    (row.status !== MediaModerationActionStatus.pending &&
      row.status !== MediaModerationActionStatus.failed &&
      row.status !== MediaModerationActionStatus.completed)
  ) {
    return null;
  }
  return {
    actionId: row.id,
    origin: meta.origin,
    status: row.status,
    attempt: row.attempt,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    waitingForTranscode:
      meta.waitingForJobId != null &&
      row.status !== MediaModerationActionStatus.completed,
    cdnRefreshedAt: isoOrNull(meta.cdnRefreshedAt),
    completedAt: row.completedAt?.toISOString() ?? null,
    error: row.errorMessage,
  };
}

/** Tier names and actual sizes recorded when the output was published. */
function renditionsOf(
  metadata: Prisma.JsonValue,
): StoryPlaybackClip['hls']['renditions'] {
  if (!isJsonObject(metadata) || !Array.isArray(metadata.renditions)) return [];
  return metadata.renditions.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const name = StoryPlaybackRenditionNameSchema.safeParse(record.name);
    if (!name.success) return [];
    return [
      {
        name: name.data,
        width: positiveIntOrNull(record.width),
        height: positiveIntOrNull(record.height),
      },
    ];
  });
}

/**
 * Display names of a draft's clip nodes, read leniently: a revision is the
 * creator's document, so a malformed node is skipped, never fatal.
 */
function sceneNames(content: Prisma.JsonValue): Map<string, string> {
  const names = new Map<string, string>();
  const graph = isJsonObject(content) ? (content.graph ?? null) : null;
  const nodes = graph !== null && isJsonObject(graph) ? graph.nodes : null;
  if (!Array.isArray(nodes)) return names;
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const record = node as Record<string, unknown>;
    if (typeof record.nodeId !== 'string') continue;
    const label = [record.name, record.clipKey].find(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    );
    if (label) names.set(record.nodeId, label.trim());
  }
  return names;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function positiveIntOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function nonNegativeIntOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}
