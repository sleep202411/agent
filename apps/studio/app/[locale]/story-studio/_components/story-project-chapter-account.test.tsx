// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryProjectChapterScope } from "./story-project-chapter-scope";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { ApiRequestError } from "@/lib/api";
const state = vi.hoisted(() => ({
  userId: "alice",
  get: vi.fn(),
  replace: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: state.userId ? { id: state.userId } : null, signIn: state.signIn }),
}));
vi.mock("@/lib/story-projects-api", () => ({ getStoryWorkbench: state.get }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/story-studio/projects/project/canvas",
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("./story-project-load-state", () => ({
  StoryProjectLoadState: ({ kind, onSignIn }: { kind: string; onSignIn: () => void }) => (
    <button onClick={onSignIn}>{kind}</button>
  ),
}));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
let client: QueryClient;
async function render(project = "project") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StoryProjectChapterScope projectId={project}>
          <div data-testid="shell">Project content</div>
        </StoryProjectChapterScope>
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
  useStoryProjectUiStore.setState({ activeChapterId: null });
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  client.clear();
  vi.resetAllMocks();
});
const projection = { chapter: { id: "chapter" }, chapters: [{ id: "chapter" }] };
it("unmounts project content and clears selected chapter while replacement account access loads", async () => {
  state.get.mockResolvedValueOnce(projection).mockImplementationOnce(() => new Promise(() => {}));
  await render();
  expect(host.querySelector('[data-testid="shell"]')).not.toBeNull();
  state.userId = "bob";
  await render();
  expect(host.querySelector('[data-testid="shell"]')).toBeNull();
  expect(useStoryProjectUiStore.getState().activeChapterId).toBeNull();
  expect(state.get).toHaveBeenCalledTimes(2);
});
it("cancels old project access and ignores a late chapter selection", async () => {
  let resolveOld!: (v: unknown) => void;
  state.get
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    )
    .mockImplementationOnce(() => new Promise(() => {}));
  await render();
  const signal = state.get.mock.calls[0]![2] as AbortSignal;
  await render("other");
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolveOld(projection);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(state.replace).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="shell"]')).toBeNull();
});
it("keeps the existing sign-in response reachable for a signed-out visitor", async () => {
  state.userId = "";
  state.get.mockRejectedValue(new ApiRequestError("HTTP_401", "Sign in", 401));
  await render();
  expect(state.get).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-testid="shell"]')).toBeNull();
  expect(host.querySelector("button")).not.toBeNull();
  await act(async () => host.querySelector("button")!.click());
  expect(state.signIn).toHaveBeenCalledTimes(1);
});
