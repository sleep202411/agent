import { describe, expect, it } from "vitest";
import type { StoryPlaybackOverview, StoryPlaybackTakedown } from "@repo/shared/story-playback";
import {
  PLAYBACK_GENERATED_AT,
  playbackAt,
  playbackClip,
  playbackGame,
  playbackOverview,
  playbackSummary,
} from "./interactive-film-playback-fixtures";
import {
  formatBitrate,
  formatBytes,
  formatClockTime,
  formatRelativeTime,
  formatSeconds,
  hlsListCell,
  playbackCataloguePill,
  reconcileNotice,
  reconcilerHeartbeat,
  reconcilerWarnings,
  retryableClipCount,
  retryFailedNotice,
  takedownStatusLabel,
} from "./interactive-film-playback-view";

const unlisted = { listed: false, version: null, versionResolved: false };

describe("hlsListCell", () => {
  it.each([
    ["an unmanaged work without cleanup", playbackGame({ managed: false, summary: null }), "—"],
    [
      "an offline work with scheduled cleanup",
      playbackGame({
        catalogue: unlisted,
        summary: null,
        cleanup: { pending: 2, nextAt: playbackAt(23 * 60 + 40), items: null },
      }),
      "待清理 2 · 23 小时后",
    ],
    [
      "an offline work whose cleanup is already running",
      playbackGame({
        catalogue: unlisted,
        summary: null,
        cleanup: { pending: 1, nextAt: null, items: null },
      }),
      "待清理 1",
    ],
  ])("rule 1: %s", (_name, game, text) => {
    expect(hlsListCell(game, PLAYBACK_GENERATED_AT)).toEqual({ text, tone: "muted" });
  });

  it("rule 2: a listed version without a playable build", () => {
    const game = playbackGame({
      catalogue: { listed: true, version: "v-legacy", versionResolved: false },
      summary: null,
    });
    expect(hlsListCell(game, PLAYBACK_GENERATED_AT)).toEqual({ text: "版本未解析", tone: "warn" });
  });

  it("names a version without video clips instead of a 0/0 success", () => {
    const game = playbackGame({ summary: playbackSummary({}) });
    expect(hlsListCell(game, PLAYBACK_GENERATED_AT)).toEqual({ text: "无视频片段", tone: "muted" });
  });

  it.each([
    ["clips not loaded", playbackSummary({ excluded: 3 }), null, "不转码"],
    ["every clip blocked", playbackSummary({ blocked: 2 }), null, "不转码（已屏蔽）"],
    [
      "one exclusion reason",
      playbackSummary({ excluded: 2 }),
      [1, 2].map((index) =>
        playbackClip(index, { hls: { state: "excluded", exclusion: "paid_content" } })
      ),
      "不转码（付费作品）",
    ],
    [
      "mixed reasons",
      playbackSummary({ excluded: 1, blocked: 1 }),
      [
        playbackClip(1, { hls: { state: "excluded", exclusion: "storage_provider" } }),
        playbackClip(2, { hls: { state: "blocked" } }),
      ],
      "不转码（混合原因）",
    ],
  ])("rule 3: nothing eligible, %s", (_name, summary, clips, text) => {
    const game = playbackGame({ summary, clips });
    expect(hlsListCell(game, PLAYBACK_GENERATED_AT)).toEqual({ text, tone: "muted" });
  });

  it("rule 4: failures win over work in flight", () => {
    const game = playbackGame({
      summary: playbackSummary({ ready: 3, failed: 1, processing: 1, queued: 1 }),
    });
    expect(hlsListCell(game, PLAYBACK_GENERATED_AT)).toEqual({
      text: "失败 1 · 3/6",
      tone: "risk",
    });
  });

  it.each([
    [{ ready: 3, processing: 1, queued: 2 }, "转码中 3/6"],
    [{ ready: 3, queued: 3 }, "排队中 3/6"],
    [{ ready: 3, notQueued: 3 }, "排队中 3/6"],
    [{ ready: 3, retrying: 3 }, "排队中 3/6"],
  ])("rule 5: %j", (counts, text) => {
    const game = playbackGame({ summary: playbackSummary(counts) });
    expect(hlsListCell(game, PLAYBACK_GENERATED_AT)).toEqual({ text, tone: "warn" });
  });

  it("rule 6: every eligible clip ready, noting blocked clips", () => {
    const ready = playbackGame({ summary: playbackSummary({ ready: 6, excluded: 1 }) });
    expect(hlsListCell(ready, PLAYBACK_GENERATED_AT)).toEqual({ text: "6/6", tone: "success" });
    const blocked = playbackGame({ summary: playbackSummary({ ready: 6, blocked: 2 }) });
    expect(hlsListCell(blocked, PLAYBACK_GENERATED_AT)).toEqual({
      text: "6/6 · 屏蔽 2",
      tone: "success",
    });
  });
});

describe("catalogue and reconciler copy", () => {
  it("labels the catalogue state", () => {
    expect(playbackCataloguePill(playbackGame({ managed: false })).text).toBe(
      "非 Story Studio 作品"
    );
    expect(playbackCataloguePill(playbackGame({ catalogue: unlisted })).text).toBe("不在玩家目录");
    expect(
      playbackCataloguePill(
        playbackGame({ catalogue: { listed: true, version: "v9", versionResolved: false } })
      )
    ).toEqual({ text: "版本未解析", tone: "warn" });
    expect(
      playbackCataloguePill(
        playbackGame({ catalogue: { listed: true, version: "v9", versionResolved: true } })
      )
    ).toEqual({ text: "玩家目录在线 · v9", tone: "success" });
  });

  it("summarises the last reconcile run relative to generatedAt", () => {
    const { reconciler } = playbackOverview([]);
    expect(reconcilerHeartbeat(reconciler, PLAYBACK_GENERATED_AT)).toBe(
      `上次对账 ${formatClockTime("2026-10-02T06:27:52.000Z")}（2 分钟前）· 间隔 2 分钟 · 目录 12 部（1 页）· 新入队 2 · 清理 1`
    );
    expect(reconcilerHeartbeat({ ...reconciler, lastRun: null }, PLAYBACK_GENERATED_AT)).toBe(
      "尚无对账记录 · 间隔 2 分钟"
    );
  });

  it("warns verbatim about failed runs, unreadable state and silence", () => {
    const { reconciler } = playbackOverview([]);
    expect(reconcilerWarnings(reconciler, PLAYBACK_GENERATED_AT)).toEqual([]);
    const failing: StoryPlaybackOverview["reconciler"] = {
      ...reconciler,
      stale: true,
      lastRun: {
        ...reconciler.lastRun!,
        status: "failed",
        error: "cycle deadline exceeded during prepare",
      },
      stateError: "Redis GET story-playback-hls:state:v1 timed out after 2000ms",
    };
    expect(reconcilerWarnings(failing, PLAYBACK_GENERATED_AT)).toEqual([
      "上次对账失败：cycle deadline exceeded during prepare",
      "对账状态读取失败：Redis GET story-playback-hls:state:v1 timed out after 2000ms",
    ]);
    const silent = { ...reconciler, stale: true, lastSucceededAt: playbackAt(-45) };
    expect(reconcilerWarnings(silent, PLAYBACK_GENERATED_AT)).toEqual([
      `对账心跳超时：6 分钟内没有成功对账，上次成功 ${formatClockTime(playbackAt(-45))}（45 分钟前）。`,
    ]);
  });
});

describe("action notices", () => {
  it("reports reconcile outcomes", () => {
    expect(reconcileNotice({ outcome: "already_running", run: null })).toMatchObject({
      tone: "info",
      message: "已有对账在运行",
    });
    const { lastRun } = playbackOverview([]).reconciler;
    expect(reconcileNotice({ outcome: "completed", run: lastRun })).toMatchObject({
      tone: "success",
      message: "对账完成：目录 12 部（1 页）· 新入队 2 · 清理 1",
    });
    expect(
      reconcileNotice({
        outcome: "completed",
        run: {
          ...lastRun!,
          status: "failed",
          error: "Java returned an empty playable-story catalogue; refusing to expire every work.",
        },
      })
    ).toMatchObject({
      tone: "risk",
      message:
        "对账失败：Java returned an empty playable-story catalogue; refusing to expire every work.",
    });
  });

  it("reports requeued clips and every refusal verbatim", () => {
    const base = { gameId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", version: "v1" };
    const assetId = "0199a1b2-c3d4-7e5f-9a9b-000000000001";
    const jobId = "0199a1b2-c3d4-7e5f-9a9b-100000000001";
    expect(
      retryFailedNotice({
        ...base,
        requeued: [{ assetId, jobId }],
        refused: [
          { assetId, reason: "IMM task t-1 is still running (Running); retry after it finishes." },
        ],
      })
    ).toEqual({
      tone: "warn",
      message: "已重新入队 1 个片段，1 个片段未重试。",
      details: [`${assetId}：IMM task t-1 is still running (Running); retry after it finishes.`],
    });
    expect(retryFailedNotice({ ...base, requeued: [], refused: [] }).message).toBe(
      "没有需要重试的片段。"
    );
  });

  it("counts retryable clips and labels takedowns", () => {
    expect(retryableClipCount(playbackSummary({ failed: 2, retrying: 1, ready: 4 }))).toBe(3);
    expect(retryableClipCount(null)).toBe(0);
    const takedown: StoryPlaybackTakedown = {
      actionId: "0199a1b2-c3d4-7e5f-9a9b-200000000001",
      origin: "moderation",
      status: "pending",
      attempt: 0,
      nextAttemptAt: null,
      waitingForTranscode: false,
      cdnRefreshedAt: null,
      completedAt: null,
      error: null,
    };
    expect(takedownStatusLabel(takedown)).toBe("清理中");
    expect(takedownStatusLabel({ ...takedown, waitingForTranscode: true })).toBe("等待转码结束");
    expect(takedownStatusLabel({ ...takedown, status: "failed" })).toBe("清理失败");
    expect(takedownStatusLabel({ ...takedown, status: "completed" })).toBe("已清理");
  });
});

describe("formatters", () => {
  it("formats bytes, durations and bitrates", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes("512")).toBe("512 B");
    expect(formatBytes("12582912")).toBe("12.0 MB");
    expect(formatBytes("3221225472")).toBe("3.0 GB");
    expect(formatSeconds(null)).toBe("—");
    expect(formatSeconds(5)).toBe("5.0 秒");
    expect(formatSeconds(48.4)).toBe("48 秒");
    expect(formatSeconds(130)).toBe("2 分 10 秒");
    expect(formatSeconds(3_720)).toBe("1 小时 02 分");
    expect(formatBitrate(2_456_000)).toBe("2.46 Mbps");
    expect(formatBitrate(800_000)).toBe("800 kbps");
  });

  it("measures relative time against generatedAt", () => {
    expect(formatRelativeTime(null, PLAYBACK_GENERATED_AT)).toBe("—");
    expect(formatRelativeTime(playbackAt(0), PLAYBACK_GENERATED_AT)).toBe("刚刚");
    expect(formatRelativeTime(playbackAt(0.5), PLAYBACK_GENERATED_AT)).toBe("1 分钟内");
    expect(formatRelativeTime(playbackAt(-3.9), PLAYBACK_GENERATED_AT)).toBe("3 分钟前");
    expect(formatRelativeTime(playbackAt(150), PLAYBACK_GENERATED_AT)).toBe("2 小时后");
    expect(formatRelativeTime(playbackAt(-3 * 24 * 60), PLAYBACK_GENERATED_AT)).toBe("3 天前");
  });
});
