// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStoryCanvasDocument, useStoryScriptDocument } from "./use-story-documents";
const state = vi.hoisted(() => ({ userId: "alice", post: vi.fn() }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: state.userId ? { id: state.userId } : null }),
}));
vi.mock("@/lib/api", () => ({ api: { post: state.post } }));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
let client: QueryClient;
function Canvas({ project }: { project: string }) {
  const q = useStoryCanvasDocument(project);
  return <div>{q.data?.id ?? "pending"}</div>;
}
function Script({ project, chapter }: { project: string; chapter: string | null }) {
  const q = useStoryScriptDocument(project, chapter);
  return <div>{q.data?.id ?? "pending"}</div>;
}
async function render(kind: string, project = "project", chapter: string | null = "chapter") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        {kind === "canvas" ? (
          <Canvas project={project} />
        ) : (
          <Script project={project} chapter={chapter} />
        )}
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
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  client.clear();
  vi.resetAllMocks();
});
it.each(["canvas", "script"])(
  "%s does not reuse a document across accounts, and cancels abandoned opens",
  async (kind) => {
    let resolveOld!: (v: unknown) => void;
    state.post.mockResolvedValueOnce({ document: { id: "alice-doc" } }).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    );
    await render(kind);
    expect(host.textContent).toBe("alice-doc");
    expect(state.post.mock.calls[0]![0]).toBe(
      kind === "canvas"
        ? "/aurora/story-projects/project/documents/canvas/ensure"
        : "/aurora/story-projects/project/chapters/chapter/documents/script/ensure"
    );
    expect(state.post.mock.calls[0]![1].body).toBeUndefined();
    state.userId = "bob";
    await render(kind);
    expect(host.textContent).toBe("pending");
    const signal = state.post.mock.calls[1]![1].signal as AbortSignal;
    state.userId = "";
    await render(kind);
    expect(signal.aborted).toBe(true);
    await act(async () => resolveOld({ document: { id: "bob-doc" } }));
    expect(host.textContent).toBe("pending");
    expect(state.post).toHaveBeenCalledTimes(2);
  }
);
it.each(["canvas", "script"])(
  "%s requires a project and cancels replacement project requests",
  async (kind) => {
    state.post.mockImplementation(() => new Promise(() => {}));
    await render(kind, "");
    expect(state.post).not.toHaveBeenCalled();
    await render(kind);
    const signal = state.post.mock.calls[0]![1].signal as AbortSignal;
    await render(kind, "other");
    expect(signal.aborted).toBe(true);
    expect(state.post).toHaveBeenCalledTimes(2);
  }
);
it("script requires a chapter and cancels the previous chapter request", async () => {
  state.post.mockImplementation(() => new Promise(() => {}));
  await render("script", "project", null);
  expect(state.post).not.toHaveBeenCalled();
  await render("script");
  const signal = state.post.mock.calls[0]![1].signal as AbortSignal;
  await render("script", "project", "other");
  expect(signal.aborted).toBe(true);
  expect(state.post).toHaveBeenCalledTimes(2);
});
