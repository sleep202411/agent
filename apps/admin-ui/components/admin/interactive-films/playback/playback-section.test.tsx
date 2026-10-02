// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  STORY_PLAYBACK_HLS_MIME_TYPE,
  type StoryPlaybackOverview,
} from "@repo/shared/story-playback";
import type { InteractiveFilmPlaybackLoadResult } from "@/lib/interactive-film-playback-view";
import {
  PLAYBACK_GAME_ID,
  playbackAssetId,
  playbackAt,
  playbackClip,
  playbackGame,
  playbackJob,
  playbackOverview,
  playbackSummary,
  playbackTakedown,
} from "@/lib/interactive-film-playback-fixtures";
import { AdminSessionBoundary } from "../../admin-session-boundary";
import { InteractiveFilmPlaybackSection } from "./playback-section";

const hlsInstances = vi.hoisted(() => [] as { destroy: () => void }[]);
vi.mock("hls.js", () => ({
  default: class {
    static Events = {
      MANIFEST_PARSED: "m",
      LEVELS_UPDATED: "u",
      LEVEL_SWITCHED: "s",
      ERROR: "e",
    };
    static isSupported() {
      return true;
    }
    levels = [];
    on() {}
    loadSource() {}
    attachMedia() {}
    destroy = vi.fn();
    constructor() {
      hlsInstances.push(this);
    }
  },
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    trigger,
    title,
    description,
    confirmLabel,
    onConfirm,
  }: {
    trigger: ReactNode;
    title: string;
    description: ReactNode;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  }) => (
    <div data-testid="confirm">
      {trigger}
      <p>{title}</p>
      <p data-testid="confirm-description">{description}</p>
      <button type="button" onClick={() => void onConfirm()}>
        {confirmLabel}
      </button>
    </div>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RELAY = "/api/admin/interactive-film-playback";
const MASTER = `https://media.fizzspace.cn/hls/${playbackAssetId(1)}/master.m3u8`;
const JOB_ERROR =
  "IMM output rejected as degenerate (task=t-3): renditions=1; segments=[1]; maxSegmentSeconds=31.2; durationSeconds=30 (source 30); missing=[]";
const TAKEDOWN_ERROR =
  "Aliyun CDN RefreshObjectCaches failed: Forbidden.RAM: User not authorized to operate on the specified resource.";
const REFUSAL = "IMM task t-9 is still running (Running); retry after it finishes.";

const clips = [
  playbackClip(1, {
    hls: {
      state: "ready",
      renditions: [
        { name: "1080p", width: 1920, height: 1080 },
        { name: "720p", width: 1280, height: 720 },
      ],
      outputBytes: "8388608",
      job: playbackJob(1, { status: "completed", transcodeSeconds: 48 }),
      playback: { url: MASTER, contentType: STORY_PLAYBACK_HLS_MIME_TYPE },
    },
  }),
  playbackClip(2, {
    hls: {
      state: "processing",
      job: playbackJob(2, {
        status: "processing",
        immTaskId: "imm-task-2",
        submittedAt: playbackAt(-3),
      }),
    },
  }),
  playbackClip(3, {
    hls: {
      state: "failed",
      job: playbackJob(3, { status: "dead", attempt: 3, error: JOB_ERROR }),
    },
  }),
  playbackClip(4, {
    hls: {
      state: "retrying",
      job: playbackJob(4, { status: "failed", attempt: 1, nextAttemptAt: playbackAt(4) }),
    },
  }),
  playbackClip(5, {
    moderation: {
      status: "blocked",
      reason: "涉及未授权肖像",
      takedown: playbackTakedown(5, { status: "failed", attempt: 2, error: TAKEDOWN_ERROR }),
    },
    hls: { state: "blocked" },
  }),
  playbackClip(6, { hls: { state: "excluded", exclusion: "paid_content" } }),
];
const summary = playbackSummary({
  ready: 1,
  processing: 1,
  failed: 1,
  retrying: 1,
  blocked: 1,
  excluded: 1,
});
const initial = playbackOverview([playbackGame({ summary, clips })]);
const settled = playbackOverview(
  [
    playbackGame({
      summary: playbackSummary({ ready: 1, processing: 1, queued: 2, blocked: 1, excluded: 1 }),
      clips,
    }),
  ],
  { generatedAt: playbackAt(1) }
);

let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();

async function render(playback: InteractiveFilmPlaybackLoadResult) {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey="alice">
        <InteractiveFilmPlaybackSection
          gameId={PLAYBACK_GAME_ID}
          title="迷雾车站"
          playback={playback}
        />
      </AdminSessionBoundary>
    )
  );
}
const ok = (data: unknown) => Response.json({ code: 200, data });
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const button = (text: string) =>
  buttons().find((item) => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === text)!;
const click = (text: string) => act(async () => button(text).click());
function metric(label: string) {
  return [...container.querySelectorAll("p")].find((p) => p.textContent === label)
    ?.nextElementSibling?.textContent;
}
function row(index: number) {
  return [...container.querySelectorAll("tbody tr")].find((tr) =>
    tr.textContent?.includes(playbackAssetId(index))
  )!;
}
function previewButton(index: number) {
  return [...row(index).querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === "预览"
  )!;
}

beforeEach(() => {
  hlsInstances.length = 0;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("shows the catalogue state, heartbeat, counts and per-clip diagnostics", async () => {
  await render({ data: initial, error: null });

  expect(container.textContent).toContain(`玩家目录在线 · ${initial.games[0]!.catalogue.version}`);
  expect(container.textContent).toContain(
    "（2 分钟前）· 间隔 2 分钟 · 目录 12 部（1 页）· 新入队 2 · 清理 1"
  );
  expect(
    ["就绪", "排队", "转码中", "重试中", "失败", "已屏蔽", "不转码"].map((label) => metric(label))
  ).toEqual(["1/4", "0", "1", "1", "1", "1", "1"]);
  expect(container.querySelector("figcaption")?.textContent).toBe(
    "已就绪1转码中1排队0重试中1失败1已屏蔽1不转码1"
  );
  expect(container.querySelectorAll('[role="img"] > span')).toHaveLength(6);
  expect(button("重试失败的片段 (2)").disabled).toBe(false);

  expect(row(1).textContent).toContain("48 秒");
  expect(
    [...row(1).querySelectorAll("[data-filled]")].map((chip) => [
      chip.textContent,
      chip.getAttribute("data-filled"),
      chip.getAttribute("title"),
    ])
  ).toEqual([
    ["1080p", "true", "1080p 1920×1080"],
    ["720p", "true", "720p 1280×720"],
    ["480p", "false", "480p 未产出"],
  ]);
  expect(row(2).textContent).toContain("已进行 3 分 00 秒");
  expect(row(2).textContent).toContain("IMM imm-task-2");
  expect(row(3).textContent).toContain(JOB_ERROR);
  expect(row(4).textContent).toContain("attempt 1/3");
  expect(row(5).textContent).toContain("涉及未授权肖像");
  expect(row(5).textContent).toContain("清理失败");
  expect(row(5).textContent).toContain(TAKEDOWN_ERROR);
  expect(row(6).textContent).toContain("付费作品");
  expect([1, 2, 3, 4, 5, 6].map((index) => previewButton(index).disabled)).toEqual([
    false,
    true,
    true,
    true,
    true,
    true,
  ]);
});

it("expands a clip to its full error, job and every place it is used", async () => {
  const shared = playbackClip(3, {
    occurrences: [
      ...clips[2]!.occurrences,
      {
        buildId: playbackAssetId(77),
        chapterRank: 2,
        chapterTitle: null,
        sceneId: "scene-finale",
        sceneLabel: "终章",
        clipIndex: 2,
        logicalKey: "scene-finale/video/1",
      },
    ],
    hls: clips[2]!.hls,
  });
  await render({
    data: playbackOverview([playbackGame({ summary, clips: [clips[0]!, shared] })]),
    error: null,
  });
  expect(row(3).textContent).toContain("另有 1 处引用");
  await act(async () =>
    [...row(3).querySelectorAll("button")]
      .find((item) => item.getAttribute("aria-label") === "展开片段详情")!
      .click()
  );
  const details = row(3).nextElementSibling!;
  expect(details.querySelector("pre")?.textContent).toBe(JOB_ERROR);
  expect(details.textContent).toContain("章节 #2 · 终章 · 片段 2");
  expect(details.textContent).toContain(`build ${playbackAssetId(77)}`);
  expect(details.textContent).toContain(playbackJob(3).id);
  expect(details.textContent).toContain("已终止");
});

it("raises the amber band with the reconciler errors verbatim", async () => {
  const failing = playbackOverview([playbackGame({ summary, clips })], {
    reconciler: {
      ...initial.reconciler,
      stale: true,
      lastRun: {
        ...initial.reconciler.lastRun!,
        status: "failed",
        error: "cycle deadline exceeded during expire",
      },
      stateError: "Redis GET story-playback-hls:state:v1 timed out after 2000ms",
    },
  });
  await render({ data: failing, error: null });
  const band = container.querySelector('[role="alert"]');
  expect(band?.textContent).toContain("上次对账失败：cycle deadline exceeded during expire");
  expect(band?.textContent).toContain(
    "对账状态读取失败：Redis GET story-playback-hls:state:v1 timed out after 2000ms"
  );
});

it("confirms the retry, posts it, reports refusals verbatim and re-reads", async () => {
  fetchMock
    .mockResolvedValueOnce(
      ok({
        gameId: PLAYBACK_GAME_ID,
        version: "v1",
        requeued: [{ assetId: playbackAssetId(3), jobId: playbackJob(3).id }],
        refused: [{ assetId: playbackAssetId(4), reason: REFUSAL }],
      })
    )
    .mockResolvedValueOnce(ok(settled));
  await render({ data: initial, error: null });
  const description = container.querySelector('[data-testid="confirm-description"]')?.textContent;
  expect(description).toContain("《迷雾车站》");
  expect(description).toContain("2 个失败或重试中的片段");
  expect(description).toContain("重新产生转码费用");

  await click("重试 2 个片段");

  expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
    [`${RELAY}/games/${PLAYBACK_GAME_ID}/retry-failed`, "POST"],
    [`${RELAY}?gameIds=${PLAYBACK_GAME_ID}&include=clips`, "GET"],
  ]);
  expect(fetchMock.mock.calls[0]![1].body).toBe("{}");
  const notice = container.querySelector('[role="status"]')?.textContent;
  expect(notice).toContain("已重新入队 1 个片段，1 个片段未重试。");
  expect(notice).toContain(`${playbackAssetId(4)}：${REFUSAL}`);
  expect(metric("排队")).toBe("2");
  expect(button("重试失败的片段 (0)").disabled).toBe(true);
});

it("reports a reconcile that is already running and still re-reads", async () => {
  fetchMock
    .mockResolvedValueOnce(ok({ outcome: "already_running", run: null }))
    .mockResolvedValueOnce(ok(settled));
  await render({ data: initial, error: null });
  await click("立即对账");
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    `${RELAY}/reconcile`,
    `${RELAY}?gameIds=${PLAYBACK_GAME_ID}&include=clips`,
  ]);
  expect(container.querySelector('[role="status"]')?.textContent).toBe("已有对账在运行");
});

it("keeps a failed action's error verbatim and still re-reads", async () => {
  // Nest requeued the clips before the call failed, so only a re-read shows it.
  fetchMock
    .mockResolvedValueOnce(
      Response.json({ statusCode: 500, message: "Internal server error" }, { status: 500 })
    )
    .mockResolvedValueOnce(ok(settled));
  await render({ data: initial, error: null });
  await click("重试 2 个片段");
  expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
    [`${RELAY}/games/${PLAYBACK_GAME_ID}/retry-failed`, "POST"],
    [`${RELAY}?gameIds=${PLAYBACK_GAME_ID}&include=clips`, "GET"],
  ]);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "重试请求失败：Internal server error"
  );
  expect(metric("排队")).toBe("2");
  expect(button("重试失败的片段 (0)").disabled).toBe(true);
});

it("recovers from a failed server read and adopts newer server renders", async () => {
  fetchMock.mockResolvedValueOnce(ok(settled));
  await render({ data: null, error: "The operation was aborted due to timeout" });
  expect(container.textContent).toContain(
    "播放分发数据加载失败：The operation was aborted due to timeout"
  );
  await click("刷新播放分发");
  expect(fetchMock.mock.calls[0]![0]).toBe(`${RELAY}?gameIds=${PLAYBACK_GAME_ID}&include=clips`);
  expect(container.textContent).not.toContain("播放分发数据加载失败");
  expect(metric("排队")).toBe("2");

  // The same failed server props again must not clobber the newer client read.
  await render({ data: null, error: "The operation was aborted due to timeout" });
  expect(metric("排队")).toBe("2");

  const newer: StoryPlaybackOverview = playbackOverview(
    [playbackGame({ summary: playbackSummary({ ready: 4, blocked: 1, excluded: 1 }), clips })],
    { generatedAt: playbackAt(5) }
  );
  await render({ data: newer, error: null });
  expect(metric("就绪")).toBe("4/4");
});

it("previews a ready clip and destroys hls.js when the preview closes", async () => {
  await render({ data: initial, error: null });
  await act(async () => previewButton(1).click());
  await act(async () => {
    await vi.waitFor(() => {
      if (!hlsInstances.length) throw new Error("preview not started");
    });
  });
  expect(document.body.textContent).toContain(MASTER);
  await click("Close");
  expect(hlsInstances).toHaveLength(1);
  expect(hlsInstances[0]!.destroy).toHaveBeenCalledTimes(1);
});

it("explains why an unlisted work has no clip states", async () => {
  await render({
    data: playbackOverview([
      playbackGame({
        catalogue: { listed: false, version: null, versionResolved: false },
        summary: null,
        cleanup: {
          pending: 1,
          nextAt: playbackAt(60),
          items: [
            {
              assetId: playbackAssetId(9),
              reason: "offline",
              state: "scheduled",
              scheduledAt: playbackAt(60),
              outputBytes: "4194304",
              takedown: null,
            },
          ],
        },
      }),
    ]),
    error: null,
  });
  expect(container.textContent).toContain("不在玩家目录");
  expect(container.textContent).toContain("作品不在玩家目录中，不会新建转码。");
  expect(container.textContent).toContain("待清理输出（1）");
  expect(container.textContent).toContain("作品下线");
  expect(container.textContent).toContain("1 小时后");
  expect(container.textContent).toContain("4.0 MB");
  expect(button("重试失败的片段 (0)").disabled).toBe(true);
});
