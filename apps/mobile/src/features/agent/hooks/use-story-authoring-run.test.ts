import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useStoryAgentRunById, useStoryAuthoringRun } from "./use-story-authoring-run";

const api = vi.hoisted(() => ({ active: vi.fn(), byId: vi.fn() }));
vi.mock("../api/story-agent-runs-api", () => ({
  getActiveStoryAgentRun: api.active,
  getStoryAgentRun: api.byId,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const project = "0195bcaa-1000-7000-8000-000000000001";
const first = "0195bcaa-1000-7000-8000-000000000002";
const second = "0195bcaa-1000-7000-8000-000000000003";
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.clearAllMocks();
});
it("clears the prior chapter immediately and ignores its late response", async () => {
  const oldRequest = deferred();
  const nextRequest = deferred();
  api.active.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(nextRequest.promise);
  let observed: unknown;
  function Probe({ chapter }: { chapter: string }) {
    observed = useStoryAuthoringRun(project, chapter, false);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe, { chapter: first })));
  await act(async () => root!.render(createElement(Probe, { chapter: second })));
  expect(observed).toBeNull();
  await act(async () => nextRequest.resolve({ id: second, status: "completed" }));
  expect(observed).toMatchObject({ id: second });
  await act(async () => oldRequest.resolve({ id: first, status: "completed" }));
  expect(observed).toMatchObject({ id: second });
});
it("clears a loaded approval when its run identity is removed", async () => {
  api.byId.mockResolvedValue({ id: first });
  let observed: unknown;
  function Probe({ runId }: { runId: string | null }) {
    observed = useStoryAgentRunById(project, runId);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe, { runId: first })));
  expect(observed).toMatchObject({ id: first });
  await act(async () => root!.render(createElement(Probe, { runId: null })));
  expect(observed).toBeNull();
  expect(api.byId).toHaveBeenCalledTimes(1);
});
it("does not let an old approval overwrite a newer request", async () => {
  const oldRequest = deferred();
  api.byId.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce({ id: second });
  let observed: unknown;
  function Probe({ runId }: { runId: string }) {
    observed = useStoryAgentRunById(project, runId);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe, { runId: first })));
  await act(async () => root!.render(createElement(Probe, { runId: second })));
  await act(async () => oldRequest.resolve({ id: first }));
  expect(observed).toMatchObject({ id: second });
});
