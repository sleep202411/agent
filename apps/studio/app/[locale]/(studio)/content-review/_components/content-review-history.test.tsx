import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ContentReviewHistory, CONTENT_REVIEW_RECORDS_QUERY_KEY } from "./content-review-history";
const state = vi.hoisted(() => ({
  user: "alice" as string | null,
  workspace: "w" as string | null,
  list: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: state.user ? { id: state.user } : null }),
}));
vi.mock("@/app/_components/workspace-context", () => ({
  useActiveWorkspaceId: () => state.workspace,
}));
vi.mock("@/lib/content-review-api", () => ({ listContentReviewRecords: state.list }));
let root: Root, container: HTMLDivElement, client: QueryClient;
const open = vi.fn();
const row = {
  id: "r",
  fileName: "Private review.mp4",
  durationSeconds: 12,
  createdByUserId: "alice",
  createdAt: "2026-10-03",
  suggestion: "review",
  creditsCharged: 1,
  findingCount: 2,
};
const render = () =>
  act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ContentReviewHistory
          selectedId={null}
          onOpen={open}
          formatSuggestion={(s) => s || "unknown"}
        />
      </QueryClientProvider>
    )
  );
const tick = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  state.user = "alice";
  state.workspace = "w";
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});
it("shows the backend error and retries loading saved reviews", async () => {
  state.list.mockRejectedValueOnce(new Error("Review service unavailable"));
  await render();
  await tick();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Review service unavailable"
  );
  state.list.mockResolvedValueOnce([row]);
  await act(async () => container.querySelector("button")!.click());
  await tick();
  expect(container.textContent).toContain(row.fileName);
  await act(async () => container.querySelector("button")!.click());
  expect(open).toHaveBeenCalledWith("r");
});
it("does not show another account's cached reviews", async () => {
  state.list.mockResolvedValueOnce([row]);
  await render();
  await tick();
  state.user = "bob";
  state.list.mockResolvedValueOnce([]);
  await render();
  await tick();
  expect(container.textContent).not.toContain(row.fileName);
  expect(container.textContent).toContain("historyEmpty");
  state.user = null;
  await render();
  expect(container.textContent).toBe("");
  expect(state.list).toHaveBeenCalledTimes(2);
});
it("hides previously cached reviews after access is revoked", async () => {
  state.list.mockResolvedValueOnce([row]);
  await render();
  await tick();
  state.list.mockRejectedValueOnce(new Error("Workspace access revoked"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: [CONTENT_REVIEW_RECORDS_QUERY_KEY, "w"] });
  });
  await tick();
  expect(container.textContent).not.toContain(row.fileName);
  expect(container.textContent).toContain("Workspace access revoked");
});
it("does not fetch without a selected workspace", async () => {
  state.workspace = null;
  await render();
  expect(container.textContent).toBe("");
  expect(state.list).not.toHaveBeenCalled();
});

it("does not style an unknown moderation result as an approval", async () => {
  state.list.mockResolvedValueOnce([{ ...row, suggestion: "pending" }]);
  await render();
  await tick();
  expect(container.querySelector(".text-emerald-300")).toBeNull();
  expect(container.textContent).toContain("pending");
});
