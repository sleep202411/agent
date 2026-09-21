import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useStoryAgentRunById, useStoryAuthoringRun } from "./use-story-authoring-run";

const api = vi.hoisted(() => ({
  active: vi.fn(),
  byId: vi.fn(),
  token: "alice-token",
  status: "authenticated",
}));
vi.mock("@/auth/use-auth", () => ({
  useAuth: () => ({
    status: api.status,
    user: { id: "alice" },
    session: { region: "com", token: { tokenName: "satoken", tokenValue: api.token } },
  }),
}));
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
  vi.useRealTimers();
  vi.clearAllMocks();
  api.token = "alice-token";
  api.status = "authenticated";
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

it.each(["active", "byId"] as const)(
  "aborts %s reads and resets evidence when credentials change",
  async (kind) => {
    const old = deferred();
    const next = deferred();
    api[kind].mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    let observed: unknown;
    function Probe() {
      const active = useStoryAuthoringRun(project, first, false);
      const byId = useStoryAgentRunById(project, first);
      observed = kind === "active" ? active : byId;
      return null;
    }
    const other = kind === "active" ? "byId" : "active";
    api[other].mockResolvedValue(null);
    root = createRoot(document.createElement("div"));
    await act(async () => root!.render(createElement(Probe)));
    const oldSignal = api[kind].mock.calls[0]![2] as AbortSignal;
    api.token = "replacement-token";
    await act(async () => root!.render(createElement(Probe)));
    expect(oldSignal.aborted).toBe(true);
    expect(observed).toBeNull();
    await act(async () => next.resolve({ id: second, status: "completed" }));
    await act(async () => old.resolve({ id: first, status: "completed" }));
    expect(observed).toMatchObject({ id: second });
  }
);
it("does not request authoring or approval evidence while signed out", async () => {
  api.status = "anonymous";
  function Probe() {
    useStoryAuthoringRun(project, first, true);
    useStoryAgentRunById(project, first);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
  expect(api.active).not.toHaveBeenCalled();
  expect(api.byId).not.toHaveBeenCalled();
});

it.each(["authoring", "applying"])(
  "retries a failed poll for an active %s run while the Agent is idle",
  async (status) => {
    vi.useFakeTimers();
    api.active.mockReset();
    api.active
      .mockResolvedValueOnce({ id: first, status })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ id: first, status: "completed" });
    let observed: unknown;
    function Probe() {
      observed = useStoryAuthoringRun(project, first, false);
      return null;
    }
    root = createRoot(document.createElement("div"));
    try {
      await act(async () => root!.render(createElement(Probe)));
      await act(async () => vi.advanceTimersByTimeAsync(1500));
      expect(api.active).toHaveBeenCalledTimes(2);
      await act(async () => vi.advanceTimersByTimeAsync(1500));
      expect(observed).toMatchObject({ status: "completed" });
      expect(api.active).toHaveBeenCalledTimes(3);
      await act(async () => vi.advanceTimersByTimeAsync(6000));
      expect(api.active).toHaveBeenCalledTimes(3);
    } finally {
      await act(async () => root?.unmount());
      root = undefined;
      vi.useRealTimers();
    }
  }
);

it("cancels a scheduled recovery poll when the view leaves", async () => {
  vi.useFakeTimers();
  api.active.mockReset();
  api.active.mockRejectedValue(new Error("offline"));
  function Probe() {
    useStoryAuthoringRun(project, first, false);
    return null;
  }
  root = createRoot(document.createElement("div"));
  try {
    await act(async () => root!.render(createElement(Probe)));
    expect(api.active).toHaveBeenCalledTimes(1);
    const signal = api.active.mock.calls[0]![2] as AbortSignal;
    await act(async () => root!.unmount());
    root = undefined;
    expect(signal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(api.active).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
it("recovers an initially failed idle read and stops on an empty run", async () => {
  vi.useFakeTimers();
  api.active.mockReset();
  api.active.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(null);
  function Probe() {
    useStoryAuthoringRun(project, first, false);
    return null;
  }
  root = createRoot(document.createElement("div"));
  try {
    await act(async () => root!.render(createElement(Probe)));
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(api.active).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root?.unmount());
    root = undefined;
    vi.useRealTimers();
  }
});

it("recovers an approval-specific lookup without replaying an approval", async () => {
  vi.useFakeTimers();
  api.byId.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ id: first });
  let observed: unknown;
  function Probe() {
    observed = useStoryAgentRunById(project, first);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(observed).toMatchObject({ id: first });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(api.byId).toHaveBeenCalledTimes(2);
});

it.each(["active", "byId"] as const)("cleans up a scheduled %s retry on logout", async (kind) => {
  vi.useFakeTimers();
  api.active.mockRejectedValue(new Error("Offline"));
  api.byId.mockRejectedValue(new Error("Offline"));
  function Probe() {
    useStoryAuthoringRun(project, first, false);
    useStoryAgentRunById(project, first);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
  api.status = "anonymous";
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(api[kind]).toHaveBeenCalledTimes(1);
});

it.each(["active", "byId"] as const)(
  "cancels a scheduled %s retry when its scope changes",
  async (kind) => {
    vi.useFakeTimers();
    api[kind]
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue({ id: second, status: "completed" });
    let observed: unknown;
    function Probe({ scope }: { scope: string }) {
      const active = useStoryAuthoringRun(project, scope, false);
      const byId = useStoryAgentRunById(project, scope);
      observed = kind === "active" ? active : byId;
      return null;
    }
    api[kind === "active" ? "byId" : "active"].mockResolvedValue(null);
    root = createRoot(document.createElement("div"));
    await act(async () => root!.render(createElement(Probe, { scope: first })));
    const signal = api[kind].mock.calls[0]![2] as AbortSignal;
    await act(async () => root!.render(createElement(Probe, { scope: second })));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(observed).toMatchObject({ id: second });
    expect(api[kind]).toHaveBeenCalledTimes(2);
  }
);
