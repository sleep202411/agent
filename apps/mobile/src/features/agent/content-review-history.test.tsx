import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ContentReviewHistory } from "./content-review-history";
const h = vi.hoisted(() => ({
  active: true,
  focused: true,
  generation: 1,
  list: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children, style }: { children: ReactNode; style: React.CSSProperties }) => (
    <div style={style}>{children}</div>
  ),
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  ActivityIndicator: () => <span>Loading</span>,
}));
vi.mock("./api/content-review-api", () => ({
  listContentReviews: h.list,
  getContentReview: h.detail,
}));
vi.mock("./content-review-create", () => ({
  ContentReviewCreate: function Creation() {
    const [selected, setSelected] = useState(false);
    return (
      <button onClick={() => setSelected(true)}>
        {selected ? "Selected source" : "Choose source"}
      </button>
    );
  },
}));
vi.mock("./content-review-export", () => ({ ContentReviewExport: () => null }));
vi.mock("./content-review-playback", () => ({ ContentReviewPlayback: () => null }));
vi.mock("./content-review-comment", () => ({ ContentReviewComment: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const item = {
  id: "report",
  fileName: "clip.mp4",
  createdAt: "2026-10-04T00:00:00Z",
  findingCount: 0,
  creditsCharged: 10,
};
const record = { ...item, durationSeconds: 30, overview: {}, details: [], comments: [] };
const render = (workspaceId = "workspace") =>
  act(async () =>
    root.render(
      <ContentReviewHistory
        workspaceId={workspaceId}
        generation={h.generation}
        onClose={() => {}}
      />
    )
  );
const click = async (text: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.focused = true;
  h.generation = 1;
  h.list.mockResolvedValue([item]);
  h.detail.mockResolvedValue(record);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("keeps the creation session through background and a failed history reload", async () => {
  await render();
  await click("Choose source");
  h.active = false;
  await render();
  expect(host.textContent).toContain("Selected source");
  expect(host.querySelector("div")!.style.display).toBe("none");
  expect(h.list).toHaveBeenCalledTimes(1);
  h.list.mockRejectedValueOnce(Error("History unavailable"));
  h.active = true;
  await render();
  expect(host.textContent).toContain("Selected source");
  expect(host.textContent).toContain("History unavailable");
  await click("contentReviewHistory.refresh");
  expect(host.textContent).toContain("Selected source");
  expect(host.textContent).toContain("clip.mp4");
});
it("returns to the same report with fresh data and never restores a failed stale snapshot", async () => {
  await render();
  await click("clip.mp4");
  expect(h.detail).toHaveBeenCalledTimes(1);
  h.active = false;
  await render();
  expect(host.textContent).not.toContain("clip.mp4");
  h.detail.mockRejectedValueOnce(Error("Access revoked"));
  h.active = true;
  await render();
  expect(h.detail).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Access revoked");
  expect(host.textContent).not.toContain("clip.mp4");
  await click("contentReviewHistory.refresh");
  expect(host.textContent).toContain("clip.mp4");
  expect(h.list).toHaveBeenCalledTimes(1);
});
it("aborts an old read on background and ignores its late result", async () => {
  let finish!: (v: unknown) => void;
  h.list.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  const signal = h.list.mock.calls[0][2] as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish([item]));
  expect(host.textContent).not.toContain("clip.mp4");
});
it("retires the creation session on workspace, account and route changes", async () => {
  await render();
  await click("Choose source");
  await render("other");
  expect(host.textContent).not.toContain("Selected source");
  await click("Choose source");
  h.generation = 2;
  await render("other");
  expect(host.textContent).not.toContain("Selected source");
  await click("Choose source");
  h.focused = false;
  await render("other");
  expect(host.textContent).toBe("");
  h.focused = true;
  await render("other");
  expect(host.textContent).not.toContain("Selected source");
});
