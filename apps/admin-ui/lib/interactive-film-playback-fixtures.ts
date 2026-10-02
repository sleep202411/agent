/**
 * Test fixtures for the HLS distribution views. Every builder runs through the
 * shared contract schema, so a fixture that Nest could never produce fails the
 * test that uses it instead of passing silently. Imported by tests only.
 */
import {
  StoryPlaybackOverviewSchema,
  type StoryPlaybackClip,
  type StoryPlaybackGame,
  type StoryPlaybackOverview,
  type StoryPlaybackTakedown,
} from "@repo/shared/story-playback";

export const PLAYBACK_GENERATED_AT = "2026-10-02T06:30:00.000Z";
export const PLAYBACK_GAME_ID = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
export const PLAYBACK_BUILD_ID = "0199a1b2-c3d4-7e5f-8a9b-1c1d2e3f4a5b";

type Summary = NonNullable<StoryPlaybackGame["summary"]>;
type Job = NonNullable<StoryPlaybackClip["hls"]["job"]>;

/** `minutes` after (or, negative, before) `PLAYBACK_GENERATED_AT`. */
export function playbackAt(minutes: number): string {
  return new Date(Date.parse(PLAYBACK_GENERATED_AT) + minutes * 60_000).toISOString();
}

export function playbackJob(index: number, overrides: Partial<Job> = {}): Job {
  return {
    id: `0199a1b2-c3d4-7e5f-aa9b-${String(index).padStart(12, "0")}`,
    status: "pending",
    attempt: 0,
    maxAttempts: 3,
    immTaskId: null,
    submittedAt: null,
    completedAt: null,
    nextAttemptAt: null,
    transcodeSeconds: null,
    error: null,
    ...overrides,
  };
}

export function playbackTakedown(
  index: number,
  overrides: Partial<StoryPlaybackTakedown> = {}
): StoryPlaybackTakedown {
  return {
    actionId: `0199a1b2-c3d4-7e5f-ba9b-${String(index).padStart(12, "0")}`,
    origin: "moderation",
    status: "pending",
    attempt: 0,
    nextAttemptAt: null,
    waitingForTranscode: false,
    cdnRefreshedAt: null,
    completedAt: null,
    error: null,
    ...overrides,
  };
}
type ClipOverrides = Partial<Omit<StoryPlaybackClip, "hls" | "moderation">> & {
  hls?: Partial<StoryPlaybackClip["hls"]>;
  moderation?: Partial<StoryPlaybackClip["moderation"]>;
};

/** A clip id that also encodes its row number, e.g. `…-000000000003`. */
export function playbackAssetId(index: number): string {
  return `0199a1b2-c3d4-7e5f-9a9b-${String(index).padStart(12, "0")}`;
}

export function playbackClip(index: number, overrides: ClipOverrides = {}): StoryPlaybackClip {
  const assetId = overrides.assetId ?? playbackAssetId(index);
  return {
    assetId,
    occurrences: [
      {
        buildId: PLAYBACK_BUILD_ID,
        chapterRank: 1,
        chapterTitle: "第一章 雨夜",
        sceneId: `scene-${index}`,
        sceneLabel: `车站 ${index}`,
        clipIndex: 1,
        logicalKey: `scene-${index}/video/0`,
      },
    ],
    durationMs: 5_000,
    source: { contentType: "video/mp4", sizeBytes: "12582912", width: 1920, height: 1080 },
    ...overrides,
    moderation: { status: "approved", reason: null, takedown: null, ...overrides.moderation },
    hls: {
      state: "not_queued",
      exclusion: null,
      renditions: [],
      outputBytes: null,
      job: null,
      playback: null,
      ...overrides.hls,
    },
  };
}

export function playbackSummary(counts: Partial<Omit<Summary, "total" | "eligible">>): Summary {
  const full = {
    ready: 0,
    queued: 0,
    processing: 0,
    retrying: 0,
    failed: 0,
    notQueued: 0,
    blocked: 0,
    excluded: 0,
    ...counts,
  };
  const total = Object.values(full).reduce((sum, value) => sum + value, 0);
  return { total, eligible: total - full.blocked - full.excluded, ...full };
}

export function playbackGame(overrides: Partial<StoryPlaybackGame> = {}): StoryPlaybackGame {
  return {
    gameId: PLAYBACK_GAME_ID,
    managed: true,
    catalogue: { listed: true, version: PLAYBACK_BUILD_ID, versionResolved: true },
    summary: playbackSummary({ ready: 1 }),
    cleanup: { pending: 0, nextAt: null, items: null },
    clips: null,
    ...overrides,
  };
}

export function playbackOverview(
  games: StoryPlaybackGame[],
  overrides: Partial<Omit<StoryPlaybackOverview, "games">> = {}
): StoryPlaybackOverview {
  return StoryPlaybackOverviewSchema.parse({
    generatedAt: PLAYBACK_GENERATED_AT,
    renditionLadder: ["1080p", "720p", "480p"],
    reconciler: {
      intervalSeconds: 120,
      graceHours: 24,
      stale: false,
      lastRun: {
        status: "succeeded",
        startedAt: "2026-10-02T06:27:40.000Z",
        finishedAt: "2026-10-02T06:27:52.000Z",
        error: null,
        stats: { cataloguePages: 1, catalogueGames: 12, enqueued: 2, expired: 1 },
      },
      lastSucceededAt: "2026-10-02T06:27:52.000Z",
      stateError: null,
    },
    ...overrides,
    games,
  });
}
