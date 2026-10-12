import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CreatorPersonalWorks } from "./creator-personal-works";
const h = vi.hoisted(() => ({ load: vi.fn(), push: vi.fn() }));
vi.mock("./personal-work-api", () => ({ getCreatorPersonalWorks: h.load }));
vi.mock("expo-router", () => ({ router: { push: h.push } }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  ActivityIndicator: () => <span>loading</span>,
  StyleSheet: { create: (value: unknown) => value },
  Platform: { select: () => ({}) },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui", () => ({
  SectionHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
  PosterImage: () => null,
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const row = { id: "film/id", title: "Film" };
const render = (id = "alice") =>
  act(async () => root.render(<CreatorPersonalWorks creatorId={id} />));
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("opens an existing work through the native player", async () => {
  h.load.mockResolvedValue({ works: [row], hasMore: false });
  await render();
  await act(async () => button("Film").click());
  expect(h.push).toHaveBeenCalledWith("/work/film%2Fid");
});
it("omits verified empty portfolios", async () => {
  h.load.mockResolvedValue({ works: [], hasMore: false });
  await render();
  expect(host.textContent).toBe("");
});
it("retries the same failed page, preserves previous works and deduplicates results", async () => {
  h.load
    .mockResolvedValueOnce({ works: [row], hasMore: true })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ works: [row, { id: "2", title: "Second" }], hasMore: false });
  await render();
  await act(async () => {
    const next = button("creatorDetail.personalWorksMore");
    next.click();
    next.click();
  });
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(h.load.mock.calls[1][1]).toBe(2);
  expect(host.textContent).toContain("Film");
  await act(async () => button("profileEdit.retry").click());
  expect(h.load.mock.calls[2][1]).toBe(2);
  expect(host.textContent?.match(/Film/g)).toHaveLength(1);
  expect(host.textContent).toContain("Second");
});
it("aborts and ignores the previous creator's delayed list", async () => {
  let finish!: (value: unknown) => void;
  h.load
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue({ works: [{ id: "b", title: "Bob" }], hasMore: false });
  await render();
  const signal = h.load.mock.calls[0][2] as AbortSignal;
  await render("bob");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ works: [row], hasMore: false }));
  expect(host.textContent).toContain("Bob");
  expect(host.textContent).not.toContain("Film");
});
