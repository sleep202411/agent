// @vitest-environment jsdom
import { act, createContext, useContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { StoryPlaybackClip } from "@repo/shared/story-playback";
import { PLAYBACK_GENERATED_AT, playbackClip } from "@/lib/interactive-film-playback-fixtures";
import { PlaybackClipTable } from "./playback-clip-table";

// Radix Select needs pointer APIs jsdom lacks; a native <select> keeps the
// table's own filtering and paging logic under test.
vi.mock("@/components/ui/select", () => {
  const Ctx = createContext<{ value: string; onValueChange: (value: string) => void } | null>(null);
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: ReactNode;
    }) => <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>,
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => {
      const ctx = useContext(Ctx)!;
      return (
        <select
          aria-label="HLS 状态筛选"
          value={ctx.value}
          onChange={(event) => ctx.onValueChange(event.target.value)}
        >
          {children}
        </select>
      );
    },
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});
vi.mock("./hls-preview-player", () => ({ HlsPreviewPlayer: () => null }));

let root: Root | undefined;
let container: HTMLDivElement;

async function render(clips: StoryPlaybackClip[]) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <PlaybackClipTable
        clips={clips}
        renditionLadder={["1080p", "720p", "480p"]}
        generatedAt={PLAYBACK_GENERATED_AT}
      />
    )
  );
}
const filter = () => container.querySelector<HTMLSelectElement>("select")!;
const options = () => [...filter().options].map((option) => option.textContent);
const rows = () => [...container.querySelectorAll("tbody tr")];
const text = () => container.textContent ?? "";
async function choose(value: string) {
  await act(async () => {
    filter().value = value;
    filter().dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const clipsOf = (failed: number, ready: number) => [
  ...Array.from({ length: failed }, (_, i) => playbackClip(i + 1, { hls: { state: "failed" } })),
  ...Array.from({ length: ready }, (_, i) =>
    playbackClip(failed + i + 1, { hls: { state: "ready" } })
  ),
];

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});

it("pages a long clip list instead of rendering every row", async () => {
  await render(clipsOf(30, 15));

  expect(rows()).toHaveLength(20);
  expect(text()).toContain("共 45 个片段");
  expect(text()).toContain("第 1 / 3 页 · 共 45 条");
});

it("filters by HLS state, lists only states present, and restarts at page one", async () => {
  await render(clipsOf(30, 15));
  expect(options()).toEqual(["全部状态（45）", "失败（30）", "已就绪（15）"]);

  await act(async () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === "下一页")!.click()
  );
  expect(text()).toContain("第 2 / 3 页");

  await choose("failed");
  expect(text()).toContain("30 / 45 个片段");
  expect(text()).toContain("第 1 / 2 页 · 共 30 条");
  expect(rows().every((row) => row.textContent?.includes("失败"))).toBe(true);

  await choose("ready");
  expect(rows()).toHaveLength(15);
  expect(text()).toContain("15 / 45 个片段");
});

it("keeps a selected state that has emptied after a refresh and says so", async () => {
  await render(clipsOf(3, 2));
  await choose("failed");
  await render(clipsOf(0, 5));

  expect(options()).toContain("失败（0）");
  expect(text()).toContain("没有该状态的片段");
});
