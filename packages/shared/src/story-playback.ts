import { z } from "zod";
import { ExperienceStableIdSchema } from "./experience-runtime/common.js";

export const STORY_PLAYBACK_HLS_MIME_TYPE = "application/vnd.apple.mpegurl" as const;
export const STORY_PLAYBACK_RENDITION_NAMES = ["1080p", "720p", "480p"] as const;
export const STORY_PLAYBACK_MAX_GAME_IDS = 100;

const IsoDateTime = z.iso.datetime();
const ByteCount = z.string().regex(/^\d+$/); // BigInt bytes as a decimal string

/* Public: GET /aurora/story-projects/:projectId/builds/:buildId/assets/:assetId/variants/:variantId/playback */
export const StoryBuildAssetPlaybackSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/ }), // absolute URL of the ready HLS master
  contentType: z.literal(STORY_PLAYBACK_HLS_MIME_TYPE),
});
export type StoryBuildAssetPlayback = z.infer<typeof StoryBuildAssetPlaybackSchema>;
/** Envelope is loose (extra keys ignored); `data` is strict. null = keep progressive /content. */
export const StoryBuildAssetPlaybackResponseSchema = z.object({
  code: z.literal(200),
  data: StoryBuildAssetPlaybackSchema.nullable(),
});
export type StoryBuildAssetPlaybackResponse = z.infer<typeof StoryBuildAssetPlaybackResponseSchema>;

/* Admin: produced by Nest; admin-ui consumes the types via `import type` (no runtime parse). */
export const StoryPlaybackRenditionNameSchema = z.enum(STORY_PLAYBACK_RENDITION_NAMES);
export const StoryPlaybackClipStateSchema = z.enum([
  "ready",
  "queued",
  "processing",
  "retrying",
  "failed",
  "not_queued",
  "blocked",
  "excluded",
]);
export const StoryPlaybackExclusionSchema = z.enum([
  "unavailable",
  "storage_provider",
  "moderation_pending",
  "pinned_rendition",
  "paid_content",
  "invalid_build",
]);

export const StoryPlaybackReconcileRunSchema = z.strictObject({
  status: z.enum(["succeeded", "failed"]),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime,
  error: z.string().nullable(), // verbatim first error (+ " (+N more)")
  stats: z.strictObject({
    cataloguePages: z.int().nonnegative(),
    catalogueGames: z.int().nonnegative(), // distinct raw gameIds Java listed
    enqueued: z.int().nonnegative(), // created + restarted jobs
    expired: z.int().nonnegative(), // variants retired this cycle
  }),
});
export type StoryPlaybackReconcileRun = z.infer<typeof StoryPlaybackReconcileRunSchema>;
export const StoryPlaybackReconcilerSchema = z.strictObject({
  intervalSeconds: z.int().positive(), // 120
  graceHours: z.int().positive(), // 24
  stale: z.boolean(), // no success within 3 × interval (or state unreadable)
  lastRun: StoryPlaybackReconcileRunSchema.nullable(),
  lastSucceededAt: IsoDateTime.nullable(),
  stateError: z.string().nullable(), // verbatim Redis read failure
});
export const StoryPlaybackSummarySchema = z.strictObject({
  total: z.int().nonnegative(), // distinct video clips of the listed version
  eligible: z.int().nonnegative(), // total - blocked - excluded
  ready: z.int().nonnegative(),
  queued: z.int().nonnegative(),
  processing: z.int().nonnegative(),
  retrying: z.int().nonnegative(),
  failed: z.int().nonnegative(),
  notQueued: z.int().nonnegative(),
  blocked: z.int().nonnegative(),
  excluded: z.int().nonnegative(),
}); // invariant: total = ready+queued+processing+retrying+failed+notQueued+blocked+excluded
export const StoryPlaybackTakedownSchema = z.strictObject({
  actionId: z.uuid(),
  origin: z.enum(["moderation", "lifecycle"]),
  status: z.enum(["pending", "failed", "completed"]),
  attempt: z.int().nonnegative(),
  nextAttemptAt: IsoDateTime.nullable(),
  waitingForTranscode: z.boolean(), // deferred until an IMM task can no longer write
  cdnRefreshedAt: IsoDateTime.nullable(),
  completedAt: IsoDateTime.nullable(),
  error: z.string().nullable(), // verbatim
});
export const StoryPlaybackCleanupItemSchema = z.strictObject({
  assetId: z.uuid(),
  reason: z.enum(["offline", "replaced"]),
  state: z.enum(["scheduled", "cleaning"]),
  scheduledAt: IsoDateTime.nullable(), // scheduled: lastVerifiedAt + 25h; cleaning: null
  outputBytes: ByteCount.nullable(),
  takedown: StoryPlaybackTakedownSchema.nullable(), // cleaning only
});
export const StoryPlaybackRenditionSchema = z.strictObject({
  name: StoryPlaybackRenditionNameSchema,
  width: z.int().positive().nullable(), // actual, from EXT-X-STREAM-INF RESOLUTION
  height: z.int().positive().nullable(),
});
export const StoryPlaybackJobSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(["pending", "processing", "completed", "failed", "cancelled", "dead"]),
  attempt: z.int().nonnegative(),
  maxAttempts: z.int().positive(),
  immTaskId: z.string().nullable(),
  submittedAt: IsoDateTime.nullable(),
  completedAt: IsoDateTime.nullable(),
  nextAttemptAt: IsoDateTime.nullable(),
  transcodeSeconds: z.number().nonnegative().nullable(), // completedAt - output.submittedAt
  error: z.string().nullable(), // verbatim MediaProcessingJob.errorMessage
});
export const StoryPlaybackClipSchema = z.strictObject({
  assetId: z.uuid(),
  occurrences: z
    .array(
      z.strictObject({
        buildId: z.uuid(),
        chapterRank: z.int().nullable(),
        chapterTitle: z.string().nullable(),
        sceneId: z.string(), // StoryVideoBuildClip.graphNodeId
        sceneLabel: z.string(), // draft node name ?? clipKey ?? sceneId
        clipIndex: z.int().positive(), // (rank % 1000) + 1
        logicalKey: z.string(),
      })
    )
    .min(1),
  durationMs: z.int().nonnegative().nullable(),
  source: z.strictObject({
    contentType: z.string(),
    sizeBytes: ByteCount.nullable(),
    width: z.int().positive().nullable(),
    height: z.int().positive().nullable(),
  }),
  moderation: z.strictObject({
    status: z.enum(["unreviewed", "approved", "flagged", "blocked"]),
    reason: z.string().nullable(),
    takedown: StoryPlaybackTakedownSchema.nullable(), // latest hls_prefix action of origin "moderation"
  }),
  hls: z.strictObject({
    state: StoryPlaybackClipStateSchema,
    exclusion: StoryPlaybackExclusionSchema.nullable(), // set iff state === "excluded"
    renditions: z.array(StoryPlaybackRenditionSchema),
    outputBytes: ByteCount.nullable(),
    job: StoryPlaybackJobSchema.nullable(),
    playback: StoryBuildAssetPlaybackSchema.nullable(), // set iff state === "ready"
  }),
});
export const StoryPlaybackGameSchema = z.strictObject({
  gameId: ExperienceStableIdSchema,
  managed: z.boolean(), // z.uuid() + StoryProject row exists
  catalogue: z.strictObject({
    listed: z.boolean(),
    version: z.string().nullable(),
    versionResolved: z.boolean(),
  }),
  summary: StoryPlaybackSummarySchema.nullable(), // null unless listed && versionResolved
  cleanup: z.strictObject({
    pending: z.int().nonnegative(), // scheduled + cleaning
    nextAt: IsoDateTime.nullable(), // earliest scheduledAt
    items: z.array(StoryPlaybackCleanupItemSchema).nullable(), // only with include=clips
  }),
  clips: z.array(StoryPlaybackClipSchema).nullable(), // only with include=clips
});
export const StoryPlaybackOverviewSchema = z.strictObject({
  generatedAt: IsoDateTime,
  renditionLadder: z.array(StoryPlaybackRenditionNameSchema),
  reconciler: StoryPlaybackReconcilerSchema,
  games: z.array(StoryPlaybackGameSchema), // same order as requested gameIds
});
export const StoryPlaybackRetryFailedResultSchema = z.strictObject({
  gameId: z.uuid(),
  version: z.string(),
  requeued: z.array(z.strictObject({ assetId: z.uuid(), jobId: z.uuid() })),
  refused: z.array(z.strictObject({ assetId: z.uuid(), reason: z.string() })), // verbatim
});
export const StoryPlaybackReconcileResultSchema = z.strictObject({
  outcome: z.enum(["completed", "already_running"]),
  run: StoryPlaybackReconcileRunSchema.nullable(),
});

export type StoryPlaybackClipState = z.infer<typeof StoryPlaybackClipStateSchema>;
export type StoryPlaybackExclusion = z.infer<typeof StoryPlaybackExclusionSchema>;
export type StoryPlaybackTakedown = z.infer<typeof StoryPlaybackTakedownSchema>;
export type StoryPlaybackClip = z.infer<typeof StoryPlaybackClipSchema>;
export type StoryPlaybackGame = z.infer<typeof StoryPlaybackGameSchema>;
export type StoryPlaybackOverview = z.infer<typeof StoryPlaybackOverviewSchema>;
export type StoryPlaybackRetryFailedResult = z.infer<typeof StoryPlaybackRetryFailedResultSchema>;
export type StoryPlaybackReconcileResult = z.infer<typeof StoryPlaybackReconcileResultSchema>;
