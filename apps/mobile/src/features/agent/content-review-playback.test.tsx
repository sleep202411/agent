import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContentReviewPlayback } from "./content-review-playback";
import { getContentReviewPlayback, type ContentReviewDetail } from "./api/content-review-api";
const h = vi.hoisted(() => ({
  generation: 1,
  status: "readyToPlay",
  source: vi.fn(),
  player: {
    pause: vi.fn(),
    play: vi.fn(),
    addListener: vi.fn(() => ({ remove: vi.fn() })),
    playing: false,
    currentTime: 0,
    seekBy(offset: number) {
      this.currentTime += offset;
    },
    staysActiveInBackground: true,
    status: "readyToPlay",
  },
}));
vi.mock("./api/content-review-api", () => ({ getContentReviewPlayback: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo", () => ({ useEvent: () => ({ status: h.status }) }));
vi.mock("expo-video", () => ({
  useVideoPlayer: (source: unknown, setup: (p: typeof h.player) => void) => {
    h.source(source);
    setup(h.player);
    return h.player;
  },
  VideoView: () => <div>video</div>,
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
const record = {
  id: "r",
  mediaAssetId: "a",
  fileName: "clip",
  durationSeconds: 60,
  creditsCharged: 10,
  findingCount: 1,
  suggestion: null,
  riskLevel: null,
  createdByUserId: "u",
  createdAt: "2026-10-01",
  exportFileName: "report",
  overview: {},
  details: [
    { timeOffset: "20000ms", label: "Finding" },
    { timeOffset: "99s", label: "Outside video" },
  ],
  comments: [{ id: "c", seconds: 5, body: "Note", createdByUserId: "u", createdAt: "2026-10-01" }],
} satisfies ContentReviewDetail;
let host: HTMLDivElement, root: Root;
const render = () =>
  act(async () =>
    root.render(<ContentReviewPlayback workspaceId="w" generation={1} record={record} />)
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.status = "readyToPlay";
  h.player.currentTime = 0;
  h.player.playing = false;
  h.player.addListener.mockImplementation(() => ({ remove: vi.fn() }));
  vi.mocked(getContentReviewPlayback).mockResolvedValue({
    assetId: "a",
    variantKey: "original",
    url: "https://files.test/video",
    expiresAt: null,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("seeks to parsed findings and comments, excludes out-of-range offsets and pauses on unmount", async () => {
  await render();
  expect(h.source).toHaveBeenCalledWith({ uri: "https://files.test/video", useCaching: false });
  expect(host.textContent).not.toContain("Outside video");
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Finding"))!.click()
  );
  expect(h.player.currentTime).toBe(20);
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Note"))!.click()
  );
  expect(h.player.currentTime).toBe(5);
  await act(async () => root.render(<div />));
  expect(h.player.pause).toHaveBeenCalled();
});
it("removes expired playback and reauthorizes instead of reusing an expired URL", async () => {
  vi.useFakeTimers();
  vi.mocked(getContentReviewPlayback)
    .mockResolvedValueOnce({
      assetId: "a",
      variantKey: "original",
      url: "https://files.test/video",
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    })
    .mockRejectedValueOnce(new Error("Permission revoked"));
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(1001));
  expect(getContentReviewPlayback).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Permission revoked");
  expect(host.textContent).not.toContain("video");
});

it("preserves position and playing intent across access renewal but resets for another report", async () => {
  await render();
  h.player.currentTime = 37;
  h.player.playing = true;
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "contentReviewHistory.reloadVideo")!
      .click()
  );
  expect(h.player.currentTime).toBe(37);
  expect(h.player.play).toHaveBeenCalledTimes(1);
  h.player.currentTime = 51;
  await act(async () =>
    root.render(
      <ContentReviewPlayback workspaceId="w" generation={1} record={{ ...record, id: "other" }} />
    )
  );
  expect(h.player.currentTime).toBe(0);
  expect(h.player.play).toHaveBeenCalledTimes(1);
});
