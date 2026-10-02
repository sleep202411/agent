// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { StoryPlaybackGame } from "@repo/shared/story-playback";
import type { AdminInteractiveFilmSummary } from "@/lib/interactive-film-admin-contract";
import {
  PLAYBACK_GAME_ID,
  PLAYBACK_GENERATED_AT,
  playbackAt,
  playbackClip,
  playbackGame,
  playbackOverview,
  playbackSummary,
} from "@/lib/interactive-film-playback-fixtures";
import { AdminSessionBoundary } from "../../admin-session-boundary";
import { InteractiveFilmReviewList } from "../interactive-film-review-list";
import { HlsDistributionCell } from "./hls-distribution-cell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ip/interactive-films",
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/ui/select", () => {
  const Wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Select: Wrap,
    SelectTrigger: Wrap,
    SelectContent: Wrap,
    SelectItem: Wrap,
    SelectValue: () => null,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const LEGACY_ID = "film_legacy";
const unlisted = { listed: false, version: null, versionResolved: false };

async function render(view: ReactNode) {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(<AdminSessionBoundary scopeKey="alice">{view}</AdminSessionBoundary>)
  );
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it.each<[string, StoryPlaybackGame, string, string | null]>([
  ["1: no work to clean", playbackGame({ managed: false, summary: null }), "—", null],
  [
    "1: scheduled cleanup of an offline work",
    playbackGame({
      catalogue: unlisted,
      summary: null,
      cleanup: { pending: 2, nextAt: playbackAt(90), items: null },
    }),
    "待清理 2 · 1 小时后",
    null,
  ],
  [
    "2: version unresolved",
    playbackGame({
      catalogue: { listed: true, version: "v2", versionResolved: false },
      summary: null,
    }),
    "版本未解析",
    "warn",
  ],
  [
    "3: nothing eligible",
    playbackGame({
      summary: playbackSummary({ excluded: 2 }),
      clips: [1, 2].map((index) =>
        playbackClip(index, { hls: { state: "excluded", exclusion: "paid_content" } })
      ),
    }),
    "不转码（付费作品）",
    null,
  ],
  [
    "4: failures",
    playbackGame({ summary: playbackSummary({ ready: 2, failed: 1, retrying: 1 }) }),
    "失败 1 · 2/4",
    "risk",
  ],
  [
    "5: transcoding",
    playbackGame({ summary: playbackSummary({ ready: 1, processing: 1, notQueued: 1 }) }),
    "转码中 1/3",
    "warn",
  ],
  [
    "5: queued",
    playbackGame({ summary: playbackSummary({ ready: 1, queued: 2 }) }),
    "排队中 1/3",
    "warn",
  ],
  [
    "6: ready with blocked clips",
    playbackGame({ summary: playbackSummary({ ready: 3, blocked: 1 }) }),
    "3/3 · 屏蔽 1",
    "success",
  ],
])("renders cell rule %s", async (_name, game, text, tone) => {
  await render(
    <HlsDistributionCell game={game} generatedAt={PLAYBACK_GENERATED_AT} loading={false} />
  );
  expect(container.textContent).toBe(text);
  expect(container.querySelector("[data-tone]")?.getAttribute("data-tone") ?? null).toBe(tone);
});

it("distinguishes a pending read from a missing row", async () => {
  await render(<HlsDistributionCell game={undefined} generatedAt={null} loading />);
  expect(container.textContent).toBe("加载中…");
  await render(<HlsDistributionCell game={undefined} generatedAt={null} loading={false} />);
  expect(container.textContent).toBe("—");
});

const item = (gameId: string, title: string): AdminInteractiveFilmSummary => ({
  gameId,
  title,
  subtitle: null,
  coverUrl: null,
  status: "published",
  draftVersion: null,
  currentVersion: "v1",
  updatedAt: null,
});

/** Every call is a new server render: a fresh `items` array, as router.refresh() gives. */
function list(
  hlsEnabled: boolean,
  items = [item(PLAYBACK_GAME_ID, "迷雾车站"), item(LEGACY_ID, "旧版影游")],
  q = ""
) {
  return (
    <InteractiveFilmReviewList
      siteLabel="FizzDragon CN"
      databaseLabel="Fixture"
      items={items}
      stats={null}
      total={items.length}
      status="all"
      q={q}
      page={1}
      pageSize={20}
      loadError={null}
      hlsEnabled={hlsEnabled}
    />
  );
}

function hlsCells() {
  const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
  const column = headers.indexOf("HLS");
  return [...container.querySelectorAll("tbody tr")].map(
    (row) => row.querySelectorAll("td")[column]?.textContent
  );
}
const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? null;

/** Holds every relay read open until the test answers it. */
function deferReads() {
  const answers: ((response: Response) => void)[] = [];
  fetchMock.mockImplementation(() => new Promise<Response>((resolve) => answers.push(resolve)));
  return (index: number, response: Response) => act(async () => answers[index]!(response));
}

it("reads the visible works through the relay after the Java list renders", async () => {
  const overview = playbackOverview([
    playbackGame({ summary: playbackSummary({ ready: 3, processing: 1 }) }),
    playbackGame({ gameId: LEGACY_ID, managed: false, catalogue: unlisted, summary: null }),
  ]);
  fetchMock.mockImplementation(async () => Response.json({ code: 200, data: overview }));
  await render(list(true));

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe(`/api/admin/interactive-film-playback?gameIds=${PLAYBACK_GAME_ID},${LEGACY_ID}`);
  expect(init.cache).toBe("no-store");
  expect(hlsCells()).toEqual(["转码中 3/4", "—"]);
  expect(container.querySelector("table")?.style.minWidth).toBe("1080px");
});

it("shows the relay failure verbatim and leaves the cells empty", async () => {
  fetchMock.mockImplementation(async () =>
    Response.json(
      {
        code: "JAVA_CATALOGUE_FAILED",
        msg: "Java playable-story catalogue failed (HTTP 503, code 503): upstream busy",
      },
      { status: 502 }
    )
  );
  await render(list(true));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "HLS 分发状态加载失败：Java playable-story catalogue failed (HTTP 503, code 503): upstream busy"
  );
  expect(hlsCells()).toEqual(["—", "—"]);
});

it("never shows a read's error to rows it was not made for", async () => {
  const answer = deferReads();
  await render(list(true));
  await answer(
    0,
    Response.json({ code: "JAVA_CATALOGUE_FAILED", msg: "Java catalogue down" }, { status: 502 })
  );
  expect(alertText()).toBe("HLS 分发状态加载失败：Java catalogue down");

  // A search without matches keeps the page mounted, with no rows and nothing to read.
  await render(list(true, [], "nomatch"));
  expect(alertText()).toBeNull();
  expect(container.textContent).toContain("没有匹配的影游作品");
  expect(fetchMock).toHaveBeenCalledTimes(1);

  // Other rows wait for their own read.
  await render(list(true, [item(LEGACY_ID, "旧版影游")], "旧版"));
  expect(alertText()).toBeNull();
  expect(hlsCells()).toEqual(["加载中…"]);
  await answer(
    1,
    Response.json({
      code: 200,
      data: playbackOverview([
        playbackGame({ gameId: LEGACY_ID, managed: false, catalogue: unlisted, summary: null }),
      ]),
    })
  );
  expect(hlsCells()).toEqual(["—"]);
});

it("keeps the column while a refresh re-reads the same rows", async () => {
  const answer = deferReads();
  const read = (summary: ReturnType<typeof playbackSummary>) =>
    Response.json({
      code: 200,
      data: playbackOverview([
        playbackGame({ summary }),
        playbackGame({ gameId: LEGACY_ID, managed: false, catalogue: unlisted, summary: null }),
      ]),
    });
  await render(list(true));
  await answer(0, read(playbackSummary({ ready: 3, processing: 1 })));
  expect(hlsCells()).toEqual(["转码中 3/4", "—"]);

  await render(list(true));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(hlsCells()).toEqual(["转码中 3/4", "—"]);
  await answer(1, read(playbackSummary({ ready: 4 })));
  expect(hlsCells()).toEqual(["4/4", "—"]);
});

it("keeps the cells a refresh still shows while new rows wait for their read", async () => {
  const answer = deferReads();
  const NEW_ID = "film_new";
  await render(list(true));
  await answer(
    0,
    Response.json({
      code: 200,
      data: playbackOverview([
        playbackGame({ summary: playbackSummary({ ready: 3, processing: 1 }) }),
        playbackGame({ gameId: LEGACY_ID, managed: false, catalogue: unlisted, summary: null }),
      ]),
    })
  );

  // A new submission on top pushes the legacy work off the page.
  await render(list(true, [item(NEW_ID, "新作品"), item(PLAYBACK_GAME_ID, "迷雾车站")]));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(hlsCells()).toEqual(["加载中…", "转码中 3/4"]);
  await answer(
    1,
    Response.json({
      code: 200,
      data: playbackOverview([
        playbackGame({ gameId: NEW_ID }),
        playbackGame({ summary: playbackSummary({ ready: 4 }) }),
      ]),
    })
  );
  expect(hlsCells()).toEqual(["1/1", "4/4"]);
});

it("has no HLS column or read off the cn site", async () => {
  await render(list(false));
  expect(fetchMock).not.toHaveBeenCalled();
  expect([...container.querySelectorAll("thead th")].map((th) => th.textContent)).not.toContain(
    "HLS"
  );
  expect(container.querySelector("table")?.style.minWidth).toBe("960px");
});
