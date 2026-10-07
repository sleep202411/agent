import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { CreatorReviews } from "./creator-reviews";
const respond = vi.fn();
const fetcher = vi.fn();
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("../../_hooks/use-creator", () => ({
  useCreatorDetail: (id: string) => ({ data: { name: `Creator ${id}` } }),
}));

const row = {
  id: "review-1",
  authorUserId: "123",
  direction: "creator",
  ratings: { productionAbility: 4, understanding: 5, communication: 3 },
  comment: "Excellent collaboration",
  scoreMilli: 4250,
  timelinessScore: 5,
  createdAt: "2026-10-01T12:00:00Z",
};
const summary = {
  creator: { count: 2, average: 4.25 },
  manager: { count: 1, average: 3 },
  total: 3,
  average: 23 / 6,
  histogram: [0, 0, 1, 2, 0],
};
let host: HTMLDivElement, root: Root, client: QueryClient;
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
async function render(id = "creator") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <CreatorReviews creatorId={id}>
          <p>Service packages stay available</p>
        </CreatorReviews>
      </QueryClientProvider>
    )
  );
  await flush();
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  fetcher.mockImplementation(
    async () =>
      new Response(JSON.stringify(await respond()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", fetcher);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  respond.mockResolvedValue({ summary, items: [row], nextCursor: null });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
it("renders actual averages and published comments without task links or private history", async () => {
  await render();
  expect(host.textContent).toContain("Excellent collaboration");
  expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("4.25");
  expect(host.querySelector("a")?.getAttribute("href")).toMatch(/^\/en-US\/creators\//);
  expect(host.querySelector('a[href*="crew"]')).toBeNull();
  expect(fetcher).toHaveBeenCalledWith(
    "/aurora/creator-profiles/creator/reviews?limit=20",
    expect.objectContaining({ credentials: "omit", cache: "no-store" })
  );
});
it("shows unrated empty scores without inventing five stars", async () => {
  respond.mockResolvedValue({
    summary: {
      creator: { count: 0, average: null },
      manager: { count: 0, average: null },
      total: 0,
      average: null,
      histogram: [0, 0, 0, 0, 0],
    },
    items: [],
    nextCursor: null,
  });
  await render();
  expect(host.textContent).toContain("unrated");
  expect(host.textContent).toContain("empty");
  expect(host.querySelector('[role="img"]')).toBeNull();
});
it("retains service controls during a review error and retries without stale comments", async () => {
  await render();
  respond.mockRejectedValueOnce(new Error("Reviews unavailable"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["creator-profile-reviews"] });
  });
  await flush();
  expect(host.textContent).toContain("Service packages stay available");
  expect(host.textContent).not.toContain("Excellent collaboration");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Reviews unavailable");
  await act(async () => host.querySelector("button")!.click());
  await flush();
  expect(host.textContent).toContain("Excellent collaboration");
});
it("paginates once and resets review history when visiting another creator", async () => {
  respond.mockResolvedValueOnce({ summary, items: [row], nextCursor: "review-1" });
  await render();
  respond.mockResolvedValueOnce({
    summary,
    items: [{ ...row, id: "review-2", comment: "Second review" }],
    nextCursor: null,
  });
  await act(async () => host.querySelector("button")!.click());
  await flush();
  expect(host.textContent).toContain("Second review");
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(
    "/aurora/creator-profiles/creator/reviews?limit=20&cursor=review-1"
  );
  await render("other");
  expect(host.textContent).not.toContain("Second review");
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/aurora/creator-profiles/other/reviews?limit=20");
});
