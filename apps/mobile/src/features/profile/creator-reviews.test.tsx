import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CreatorReviews } from "./creator-reviews";
const h = vi.hoisted(() => ({
  load: vi.fn(),
  push: vi.fn(),
  active: true,
  t: (key: string) => key,
}));
vi.mock("./creator-reviews-api", () => ({ fetchCreatorReviews: h.load }));
vi.mock("@/data/browse-service", () => ({ getCreatorById: async () => undefined }));
vi.mock("expo-router", () => ({ router: { push: h.push } }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  ActivityIndicator: () => <span>loading</span>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui", () => ({
  SectionHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t, useLocale: () => "en-US" }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const row = {
  id: "review",
  authorUserId: "author/id",
  direction: "creator",
  comment: "Helpful collaborator",
  scoreMilli: 4500,
  timelinessScore: 5,
  createdAt: "2026-10-06T00:00:00Z",
};
const summary = {
  creator: { count: 1, average: 4.5 },
  manager: { count: 0, average: null },
  total: 1,
  average: 4.5,
  histogram: [0, 0, 0, 0, 1],
};
const page = { items: [row], summary, nextCursor: null };
const render = (id = "alice") => act(async () => root.render(<CreatorReviews creatorId={id} />));
const click = (label: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("renders public summaries and opens reviewer profiles", async () => {
  h.load.mockResolvedValue(page);
  await render();
  expect(host.textContent).toContain(row.comment);
  expect(host.textContent).toContain("creatorReviews.timeliness");
  await click("creatorReviews.reviewer");
  expect(h.push).toHaveBeenCalledWith("/creator/author%2Fid");
});
it("retries the failed page without losing earlier reviews or duplicating them", async () => {
  h.load
    .mockResolvedValueOnce({ ...page, nextCursor: "next" })
    .mockRejectedValueOnce(Error("Offline"))
    .mockResolvedValueOnce({
      ...page,
      items: [row, { ...row, id: "second", comment: "Second review" }],
    });
  await render();
  await click("creatorReviews.more");
  expect(host.textContent).toContain(row.comment);
  expect(host.textContent).toContain("Offline");
  await click("creatorReviews.retry");
  expect(h.load.mock.calls[2][1]).toBe("next");
  expect(host.textContent?.match(/Helpful collaborator/g)).toHaveLength(1);
  expect(host.textContent).toContain("Second review");
});
it("aborts and ignores stale responses after creator changes and backgrounding", async () => {
  let finish!: (value: unknown) => void;
  h.load
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue({ ...page, items: [] });
  await render();
  const signal = h.load.mock.calls[0][2] as AbortSignal;
  await render("bob");
  expect(signal.aborted).toBe(true);
  await act(async () => finish(page));
  expect(host.textContent).not.toContain(row.comment);
  h.active = false;
  await render("bob");
  expect(host.textContent).toBe("");
  h.load.mockResolvedValue(page);
  h.active = true;
  await render("bob");
  expect(host.textContent).toContain(row.comment);
});
it("rejects cyclic pagination without appending the invalid page", async () => {
  h.load.mockResolvedValue({ ...page, nextCursor: "same" });
  await render();
  await click("creatorReviews.more");
  expect(host.textContent).toContain("contentGpsDiscovery.responseMismatch");
  expect(host.textContent?.match(/Helpful collaborator/g)).toHaveLength(1);
});
