// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStoryAssetMentions } from "./story-prompt-composer";
const state = vi.hoisted(() => ({ userId: "alice", list: vi.fn() }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: state.userId ? { id: state.userId } : null }),
}));
vi.mock("@/lib/story-production-api", () => ({
  storyProductionKeys: { assets: (p: string, c: string) => ["assets", p, c] },
  listStoryAssetSpecs: state.list,
}));
vi.mock("@/components/canvas/authoring/prompt-textarea", () => ({ PromptTextarea: () => null }));
vi.mock("./project-canvas/story-candidate-asset-picker-dialog", () => ({
  StoryCandidateAssetPickerDialog: () => null,
}));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
let client: QueryClient;
function Mentions({ project = "project" }: { project?: string }) {
  const items = useStoryAssetMentions(project, "chapter");
  return <div>{items.map((i) => i.name).join(",")}</div>;
}
async function render(project = "project") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Mentions project={project} />
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
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  client.clear();
  vi.resetAllMocks();
});
it("does not reuse another account's prompt references", async () => {
  state.list
    .mockResolvedValueOnce([{ id: "asset", stableKey: "hero", name: "Alice reference" }])
    .mockImplementationOnce(() => new Promise(() => {}));
  await render();
  expect(host.textContent).toContain("Alice reference");
  state.userId = "bob";
  await render();
  expect(host.textContent).not.toContain("Alice reference");
  expect(state.list).toHaveBeenCalledTimes(2);
  const signal = state.list.mock.calls[1]![2] as AbortSignal;
  state.userId = "";
  await render();
  expect(signal.aborted).toBe(true);
  expect(state.list).toHaveBeenCalledTimes(2);
});
it("cancels abandoned project reads and requires a project and account", async () => {
  state.list.mockImplementation(() => new Promise(() => {}));
  await render("");
  expect(state.list).not.toHaveBeenCalled();
  await render();
  const signal = state.list.mock.calls[0]![2] as AbortSignal;
  await render("other");
  expect(signal.aborted).toBe(true);
  expect(state.list).toHaveBeenCalledTimes(2);
});
