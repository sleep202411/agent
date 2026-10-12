// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
function renderHook<T, P = undefined>(hook: (props: P) => T, options?: { initialProps: P }) {
  let props = options?.initialProps as P;
  const result = { current: undefined as T };
  const host = document.createElement("div");
  const root = createRoot(host);
  function Probe() {
    result.current = hook(props);
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return {
    result,
    rerender(next: P) {
      props = next;
      act(() => root.render(createElement(Probe)));
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}
const waitFor = vi.waitFor;
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDirectorDeskImport } from "./use-director-desk-import";
const mocks = vi.hoisted(() => ({
  t: (key: string) => key,
  store: { directorDeskOpen: true, openDirectorDesk: vi.fn(), closeDirectorDesk: vi.fn() },
  graph: {
    canEdit: true,
    addAssets: vi.fn(),
    addNode: vi.fn(),
    getNodes: () => [],
    selectNodes: vi.fn(),
  },
  upload: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => mocks.t }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/_components/region-provider", () => ({ useSiteRegion: () => "global" }));
vi.mock("@/app/[locale]/project/_stores/project-ui-store", () => ({
  useProjectUIStore: (select: (s: typeof mocks.store) => unknown) => select(mocks.store),
}));
vi.mock("@/lib/canvas-core/canvas-graph-context", () => ({
  useCanvasGraphContext: () => mocks.graph,
}));
vi.mock("@/lib/canvas-authoring/director-desk-import", async (original) => ({
  ...(await original<object>()),
  importDirectorCaptures: mocks.upload,
}));
const target = { postMessage: vi.fn() } as unknown as Window;
const asset = { id: "asset", mediaAssetId: "asset", url: "/a.png", name: "a" };
function send(
  op: string,
  options: { origin?: string; source?: Window | null; project?: string } = {}
) {
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: options.origin ?? "https://java.fizzdragon.com",
        source: options.source === undefined ? target : options.source,
        data: {
          type: "storyai:director-desk-captures-sent",
          payload: {
            operationId: op,
            instanceId: options.project ?? "project",
            captures: [{ dataUrl: "data:image/png;base64,YQ==" }],
          },
        },
      })
    )
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.directorDeskOpen = true;
  mocks.upload.mockResolvedValue([asset]);
});
afterEach(() => vi.useRealTimers());
it("rejects unsolicited, wrong-frame, wrong-region and wrong-project captures", () => {
  const { result, unmount } = renderHook(() =>
    useDirectorDeskImport({ projectId: "project", workspaceId: "ws", canEdit: true })
  );
  send("unsolicited");
  act(() => result.current.capture(target));
  send("frame", { source: null });
  send("region", { origin: "https://java.fizzspace.cn" });
  send("project", { project: "other" });
  expect(mocks.upload).not.toHaveBeenCalled();
  unmount();
});
it("queues a second operation and deduplicates deliveries while uploading", async () => {
  let finish!: (value: (typeof asset)[]) => void;
  mocks.upload.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result, unmount } = renderHook(() =>
    useDirectorDeskImport({ projectId: "project", canEdit: true })
  );
  act(() => result.current.capture(target));
  send("one");
  send("two");
  send("two");
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  await act(async () => finish([asset]));
  await waitFor(() => expect(mocks.graph.addNode).toHaveBeenCalledTimes(2));
  expect(mocks.upload).toHaveBeenCalledTimes(2);
  unmount();
});
it("ignores old staging request IDs and accepts the active one", async () => {
  const { result, unmount } = renderHook(() =>
    useDirectorDeskImport({ projectId: "project", canEdit: true })
  );
  act(() => result.current.capture(target));
  const request = vi
    .mocked(target.postMessage)
    .mock.calls.find(([data]) => data.type === "workbench:staging")![0];
  const deliver = (requestId: string) =>
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: target,
          origin: "https://java.fizzdragon.com",
          data: {
            type: "workbench:staging-result",
            requestId,
            result: { capture: { dataUrl: "data:image/png;base64,YQ==" } },
          },
        })
      )
    );
  deliver("stale");
  expect(mocks.upload).not.toHaveBeenCalled();
  deliver(request.requestId);
  await waitFor(() => expect(mocks.graph.addNode).toHaveBeenCalledOnce());
  unmount();
});
it("does not insert an upload after project navigation", async () => {
  let finish!: (value: (typeof asset)[]) => void;
  mocks.upload.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result, rerender, unmount } = renderHook(
    ({ projectId }) => useDirectorDeskImport({ projectId, canEdit: true }),
    { initialProps: { projectId: "project" } }
  );
  act(() => result.current.capture(target));
  send("one");
  rerender({ projectId: "other" });
  await act(async () => finish([asset]));
  expect(mocks.graph.addNode).not.toHaveBeenCalled();
  unmount();
});
it("keeps an upload active beyond the capture timeout and permits retry after failure", async () => {
  vi.useFakeTimers();
  let fail!: (error: Error) => void;
  mocks.upload.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      })
  );
  const { result, unmount } = renderHook(() =>
    useDirectorDeskImport({ projectId: "project", canEdit: true })
  );
  act(() => result.current.capture(target));
  send("one");
  act(() => vi.advanceTimersByTime(46000));
  expect(result.current.busy).toBe(true);
  await act(async () => fail(new Error("upload failed")));
  expect(result.current.busy).toBe(false);
  act(() => result.current.capture(target));
  send("one");
  await act(async () => {});
  expect(mocks.graph.addNode).toHaveBeenCalledOnce();
  unmount();
});
