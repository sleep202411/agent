import { describe, expect, it } from "vitest";
import {
  STORY_PLAYBACK_HLS_MIME_TYPE,
  STORY_PLAYBACK_RENDITION_NAMES,
  StoryBuildAssetPlaybackResponseSchema,
  StoryBuildAssetPlaybackSchema,
  StoryPlaybackClipSchema,
  StoryPlaybackClipStateSchema,
  StoryPlaybackExclusionSchema,
  StoryPlaybackOverviewSchema,
  StoryPlaybackSummarySchema,
  type StoryBuildAssetPlayback,
  type StoryPlaybackClip,
  type StoryPlaybackClipState,
  type StoryPlaybackExclusion,
  type StoryPlaybackOverview,
} from "./story-playback.js";

const ASSET_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const RETIRED_ASSET_ID = "3d813cbb-47fb-42ba-91df-831e1593ac29";
const BUILD_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const GAME_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const JOB_ID = "9b2f4c1e-8d3a-4f6b-b5e7-2a1c0d9e8f7a";
const ACTION_ID = "c56a4180-65aa-42ec-a945-5fd21dec0538";

const CLIP_STATES = [
  "ready",
  "queued",
  "processing",
  "retrying",
  "failed",
  "not_queued",
  "blocked",
  "excluded",
] as const satisfies readonly StoryPlaybackClipState[];
const EXCLUSIONS = [
  "unavailable",
  "storage_provider",
  "moderation_pending",
  "pinned_rendition",
  "paid_content",
  "invalid_build",
] as const satisfies readonly StoryPlaybackExclusion[];

const PLAYBACK = {
  url: `https://media.example.com/hls/${ASSET_ID}/master.m3u8`,
  contentType: STORY_PLAYBACK_HLS_MIME_TYPE,
} satisfies StoryBuildAssetPlayback;

function clip(
  state: StoryPlaybackClipState,
  exclusion: StoryPlaybackExclusion | null = null
): StoryPlaybackClip {
  const ready = state === "ready";
  return {
    assetId: ASSET_ID,
    occurrences: [
      {
        buildId: BUILD_ID,
        chapterRank: 1,
        chapterTitle: "The Gate",
        sceneId: "node-opening",
        sceneLabel: "Opening",
        clipIndex: 1,
        logicalKey: "node-opening/segment-1",
      },
    ],
    durationMs: 14_000,
    source: { contentType: "video/mp4", sizeBytes: "18874368", width: 1920, height: 1080 },
    moderation: {
      status: state === "blocked" ? "blocked" : "approved",
      reason: null,
      takedown: null,
    },
    hls: {
      state,
      exclusion,
      renditions: ready
        ? [
            { name: "1080p", width: 1920, height: 1080 },
            { name: "720p", width: 1280, height: 720 },
            { name: "480p", width: 854, height: 480 },
          ]
        : [],
      outputBytes: ready ? "9437184" : null,
      job: ready
        ? {
            id: JOB_ID,
            status: "completed",
            attempt: 1,
            maxAttempts: 5,
            immTaskId: "imm-task-1",
            submittedAt: "2026-10-02T07:50:00.000Z",
            completedAt: "2026-10-02T07:52:30.000Z",
            nextAttemptAt: null,
            transcodeSeconds: 150,
            error: null,
          }
        : null,
      playback: ready ? PLAYBACK : null,
    },
  };
}

describe("story playback contract", () => {
  it("accepts an absolute http(s) HLS master URL and nothing else", () => {
    expect(StoryBuildAssetPlaybackSchema.parse(PLAYBACK)).toEqual(PLAYBACK);
    expect(
      StoryBuildAssetPlaybackSchema.safeParse({
        ...PLAYBACK,
        url: "http://media.example.com/hls/master.m3u8",
      }).success
    ).toBe(true);
    for (const url of [
      "ftp://media.example.com/hls/master.m3u8",
      "javascript:alert(1)",
      "data:application/vnd.apple.mpegurl;base64,I0VYVE0zVQ==",
      "blob:https://media.example.com/0f8fad5b",
      "file:///hls/master.m3u8",
      "/hls/master.m3u8",
    ]) {
      expect(StoryBuildAssetPlaybackSchema.safeParse({ ...PLAYBACK, url }).success, url).toBe(
        false
      );
    }
  });

  it("ignores extra envelope keys but rejects a malformed data payload", () => {
    expect(
      StoryBuildAssetPlaybackResponseSchema.parse({
        code: 200,
        msg: "success",
        requestId: "req-1",
        data: PLAYBACK,
      })
    ).toEqual({ code: 200, data: PLAYBACK });
    expect(StoryBuildAssetPlaybackResponseSchema.parse({ code: 200, msg: "", data: null })).toEqual(
      { code: 200, data: null }
    );

    for (const data of [
      { ...PLAYBACK, expiresAt: "2026-10-02T08:00:00.000Z" },
      { ...PLAYBACK, contentType: "video/mp4" },
      { ...PLAYBACK, url: "ftp://media.example.com/hls/master.m3u8" },
      { url: PLAYBACK.url },
      undefined,
    ]) {
      expect(
        StoryBuildAssetPlaybackResponseSchema.safeParse({ code: 200, msg: "success", data }).success
      ).toBe(false);
    }
    expect(
      StoryBuildAssetPlaybackResponseSchema.safeParse({ code: 500, msg: "upstream", data: null })
        .success
    ).toBe(false);
  });

  it("parses every clip state and exclusion reason", () => {
    expect(StoryPlaybackClipStateSchema.options).toEqual(CLIP_STATES);
    expect(StoryPlaybackExclusionSchema.options).toEqual(EXCLUSIONS);

    for (const state of CLIP_STATES) {
      expect(StoryPlaybackClipStateSchema.parse(state)).toBe(state);
      const value = state === "excluded" ? clip(state, "paid_content") : clip(state);
      expect(StoryPlaybackClipSchema.parse(value)).toEqual(value);
    }
    for (const exclusion of EXCLUSIONS) {
      expect(StoryPlaybackExclusionSchema.parse(exclusion)).toBe(exclusion);
      const value = clip("excluded", exclusion);
      expect(StoryPlaybackClipSchema.parse(value)).toEqual(value);
    }

    expect(StoryPlaybackClipStateSchema.safeParse("cancelled").success).toBe(false);
    expect(StoryPlaybackExclusionSchema.safeParse("blocked").success).toBe(false);
  });

  it("parses an overview whose summary buckets add up to the total", () => {
    const summary = {
      total: 12,
      eligible: 9,
      ready: 4,
      queued: 1,
      processing: 1,
      retrying: 1,
      failed: 1,
      notQueued: 1,
      blocked: 1,
      excluded: 2,
    };
    expect(
      summary.ready +
        summary.queued +
        summary.processing +
        summary.retrying +
        summary.failed +
        summary.notQueued +
        summary.blocked +
        summary.excluded
    ).toBe(summary.total);
    expect(summary.eligible).toBe(summary.total - summary.blocked - summary.excluded);
    expect(StoryPlaybackSummarySchema.parse(summary)).toEqual(summary);
    expect(StoryPlaybackSummarySchema.safeParse({ ...summary, ready: 4.5 }).success).toBe(false);
    expect(StoryPlaybackSummarySchema.safeParse({ ...summary, failed: -1 }).success).toBe(false);

    const overview = {
      generatedAt: "2026-10-02T08:00:00.000Z",
      renditionLadder: [...STORY_PLAYBACK_RENDITION_NAMES],
      reconciler: {
        intervalSeconds: 120,
        graceHours: 24,
        stale: false,
        lastRun: {
          status: "succeeded",
          startedAt: "2026-10-02T07:58:00.000Z",
          finishedAt: "2026-10-02T07:58:04.250Z",
          error: null,
          stats: { cataloguePages: 1, catalogueGames: 2, enqueued: 2, expired: 0 },
        },
        lastSucceededAt: "2026-10-02T07:58:04.250Z",
        stateError: null,
      },
      games: [
        {
          gameId: GAME_ID,
          managed: true,
          catalogue: { listed: true, version: BUILD_ID, versionResolved: true },
          summary,
          cleanup: {
            pending: 2,
            nextAt: "2026-10-03T09:00:00.000Z",
            items: [
              {
                assetId: RETIRED_ASSET_ID,
                reason: "replaced",
                state: "scheduled",
                scheduledAt: "2026-10-03T09:00:00.000Z",
                outputBytes: "9007199254740993",
                takedown: null,
              },
              {
                assetId: ASSET_ID,
                reason: "offline",
                state: "cleaning",
                scheduledAt: null,
                outputBytes: null,
                takedown: {
                  actionId: ACTION_ID,
                  origin: "lifecycle",
                  status: "pending",
                  attempt: 1,
                  nextAttemptAt: "2026-10-02T08:01:00.000Z",
                  waitingForTranscode: true,
                  cdnRefreshedAt: null,
                  completedAt: null,
                  error: null,
                },
              },
            ],
          },
          clips: [clip("ready")],
        },
        {
          gameId: "legacy:game-42",
          managed: false,
          catalogue: { listed: true, version: null, versionResolved: false },
          summary: null,
          cleanup: { pending: 0, nextAt: null, items: null },
          clips: null,
        },
      ],
    } satisfies StoryPlaybackOverview;
    expect(StoryPlaybackOverviewSchema.parse(overview)).toEqual(overview);
  });

  it("carries BigInt byte counts as decimal strings", () => {
    const value = clip("ready");
    for (const outputBytes of ["0", "9007199254740993"]) {
      expect(
        StoryPlaybackClipSchema.safeParse({ ...value, hls: { ...value.hls, outputBytes } }).success
      ).toBe(true);
    }
    for (const outputBytes of [9_437_184, "-1", "1.5", "1e6", ""]) {
      expect(
        StoryPlaybackClipSchema.safeParse({ ...value, hls: { ...value.hls, outputBytes } }).success,
        String(outputBytes)
      ).toBe(false);
    }
  });
});
