// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryAssetsGallery } from "./story-assets-gallery";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
const state = vi.hoisted(() => ({ userId: "alice", list: vi.fn() }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: state.userId ? { id: state.userId } : null }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/assets",
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("../_lib/use-story-chapter-workbench", () => ({
  useStoryChapterWorkbench: () => ({ data: { project: { capabilities: [] } } }),
}));
vi.mock("@/lib/story-production-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/story-production-api")>()),
  listStoryAssetSpecs: state.list,
}));
vi.mock("./story-asset-spec-card", () => ({
  StoryAssetSpecCard: ({ asset }: { asset: { name: string } }) => <div>{asset.name}</div>,
}));
vi.mock("./story-asset-spec-create-dialog", () => ({ StoryAssetSpecCreateDialog: () => null }));
vi.mock("./story-asset-batch-generation", () => ({ StoryAssetBatchGeneration: () => null }));
vi.mock("./story-production-page-header", () => ({
  StoryProductionPageHeader: () => null,
  StoryProductionGenerationControls: () => null,
}));
vi.mock("./story-stage-empty-state", () => ({
  StoryStageEmptyState: () => null,
  StoryStageLoadingState: () => null,
}));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
let client: QueryClient;
async function render(project = "project") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StoryAssetsGallery projectId={project} />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.userId = "alice";
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  useStoryProjectUiStore.setState({ activeChapterId: "chapter" });
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  client.clear();
  vi.resetAllMocks();
});
it("does not reuse the former account's gallery and cancels a signed-out read", async () => {
  state.list
    .mockResolvedValueOnce([
      {
        id: "asset",
        name: "Alice private",
        kind: "character",
        status: "current",
        selectedMediaVersion: null,
      },
    ])
    .mockImplementationOnce(() => new Promise(() => {}));
  await render();
  expect(host.textContent).toContain("Alice private");
  state.userId = "bob";
  await render();
  expect(host.textContent).not.toContain("Alice private");
  expect(state.list).toHaveBeenCalledTimes(2);
  const signal = state.list.mock.calls[1]![2] as AbortSignal;
  state.userId = "";
  await render();
  expect(signal.aborted).toBe(true);
  expect(state.list).toHaveBeenCalledTimes(2);
});
it("requires a project and cancels reads after chapter and project replacement", async () => {
  state.list.mockImplementation(() => new Promise(() => {}));
  await render("");
  expect(state.list).not.toHaveBeenCalled();
  await render();
  const first = state.list.mock.calls[0]![2] as AbortSignal;
  await act(async () => useStoryProjectUiStore.setState({ activeChapterId: "other" }));
  await render();
  expect(first.aborted).toBe(true);
  const second = state.list.mock.calls[1]![2] as AbortSignal;
  await render("other-project");
  expect(second.aborted).toBe(true);
  expect(state.list).toHaveBeenCalledTimes(3);
});
