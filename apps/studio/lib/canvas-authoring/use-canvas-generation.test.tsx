// @vitest-environment jsdom
import { act, useLayoutEffect, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasGraphStore } from "@/lib/canvas-core/canvas-graph-context";
import type { CanvasNodeShape } from "@/lib/canvas-core/types";
import { ApiRequestError } from "@/lib/api";
import { CanvasGenerationProvider, useGeneration } from "./use-canvas-generation";
import {
  cancelFizzAiJob,
  submitFizzAiJob,
  getFizzAiJob,
  listFizzAiJobs,
  type FizzAiCatalog,
  type FizzAiJobView,
  type GenerationState,
} from "./generation-api";

const mocks = vi.hoisted(() => ({
  getGraph: vi.fn(),
  fields: vi.fn(),
  probe: vi.fn(),
  connected: false,
  onEvent: (_event: unknown) => {},
  userId: "owner",
  documentId: "document",
  canGenerate: true,
}));
vi.mock("@/lib/canvas-core/canvas-graph-context", () => ({
  useCanvasGraphContext: mocks.getGraph,
}));
vi.mock("./probe-media-duration", () => ({
  probeMediaDurationSeconds: (...args: unknown[]) => mocks.probe(...args),
}));
const translate = (key: string) => key;
vi.mock("next-intl", () => ({ useTranslations: () => translate }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: mocks.userId } }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/app/_components/compute-recharge-dialog", () => ({ ComputeRechargeDialog: () => null }));
vi.mock("@/app/_components/credits-badge", () => ({
  useComputeWalletBalance: () => ({ data: undefined }),
  computeWalletBalanceQueryKey: ["wallet"],
}));
vi.mock("@/app/[locale]/project/_components/project-context", () => ({
  useProjectPayerWorkspace: () => null,
}));
vi.mock("./assets-realtime-kernel", () => ({
  getAssetsRealtimeKernel: () => ({
    subscribe: (callbacks: { onConnected: () => void; onEvent: (event: unknown) => void }) => {
      mocks.onEvent = callbacks.onEvent;
      if (mocks.connected) callbacks.onConnected();
      return { close: vi.fn() };
    },
  }),
}));
vi.mock("@/lib/project-skill-runtime", () => ({
  generationSkillScope: () => "video",
  compatibleProjectSkillInstallations: () => [],
  sanitizeProjectSkillSelection: () => undefined,
  resolveEffectiveProjectSkills: () => [],
  composePromptWithProjectSkills: (prompt: string) => prompt,
}));
vi.mock("./generation-api", async (original) => ({
  ...(await original<typeof import("./generation-api")>()),
  cancelFizzAiJob: vi.fn(),
  submitFizzAiJob: vi.fn(),
  getFizzAiJob: vi.fn(),
  listFizzAiJobs: vi.fn(),
  promptRequired: () => false,
  referenceFieldsForMode: () => mocks.fields(),
  validateModelGenerationInput: () => [],
  generationInputHasBlockingIssues: () => false,
}));

const catalog = {
  models: [{ id: "wan", type: "video", name: "Wan", schemaVersion: "1", input_schema: {} }],
} as FizzAiCatalog;
const projectSkills = { data: {} as never, loading: false, error: false };
const context = {
  projectId: "project",
  documentId: "document",
  sourceSurface: "fizzstudio-canvas",
};
const job = {
  id: "job-1",
  modelId: "wan",
  documentBlockId: "node",
  documentId: "document",
  status: "completed",
  type: "video",
  input: {},
  outputs: [{ id: "output", assetId: "asset", type: "video", url: "https://cdn.test/video.mp4" }],
} as FizzAiJobView;
let nodes: CanvasNodeShape[];
let graph: CanvasGraphStore;
let notify = () => {};
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let actions: ReturnType<typeof useGeneration>;
const state = () => nodes[0].data.generation as GenerationState;
function Controls() {
  const current = useGeneration();
  useLayoutEffect(() => {
    actions = current;
  }, [current]);
  return null;
}
function Harness() {
  const [, render] = useReducer((value) => value + 1, 0);
  useLayoutEffect(() => {
    notify = render;
    return () => {
      notify = () => {};
    };
  }, [render]);
  return (
    <QueryClientProvider client={client}>
      <CanvasGenerationProvider
        catalog={catalog}
        context={{ ...context, documentId: mocks.documentId }}
        projectSkills={projectSkills}
        canGenerate={mocks.canGenerate}
      >
        <Controls />
      </CanvasGenerationProvider>
    </QueryClientProvider>
  );
}
async function mount() {
  await act(async () => root.render(<Harness />));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.fields.mockReturnValue([]);
  mocks.probe.mockResolvedValue(null);
  mocks.connected = false;
  mocks.userId = "owner";
  mocks.documentId = "document";
  mocks.canGenerate = true;
  nodes = [
    {
      id: "node",
      type: "video",
      position: { x: 0, y: 0 },
      data: { modelId: "wan", prompt: "test" },
    },
  ];
  graph = {
    get nodes() {
      return nodes;
    },
    getNodes: () => nodes,
    getNode: (id: string) => nodes.find((node) => node.id === id) ?? null,
    getEdges: () => [],
    patchNodeData: (id: string, patch: Parameters<CanvasGraphStore["patchNodeData"]>[1]) => {
      nodes = nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: { ...node.data, ...(typeof patch === "function" ? patch(node) : patch) },
            }
          : node
      );
      notify();
    },
    addAssets: vi.fn(),
    addNode: vi.fn(),
    removeNode: vi.fn(),
    removeEdge: vi.fn(),
    removeAssetsByMediaAssetId: vi.fn(),
  } as unknown as CanvasGraphStore;
  mocks.getGraph.mockImplementation(() => graph);
  vi.mocked(listFizzAiJobs).mockResolvedValue({ jobs: [], nextCursor: null });
  vi.mocked(getFizzAiJob).mockResolvedValue(job);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.useRealTimers();
});

describe("canvas task lifecycle", () => {
  it("does not replace live progress with a late submission acknowledgement", async () => {
    let acknowledge!: (value: never) => void;
    let finishJob!: (value: FizzAiJobView) => void;
    vi.mocked(submitFizzAiJob).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        })
    );
    vi.mocked(getFizzAiJob).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishJob = resolve;
        })
    );
    await mount();
    await act(async () => {
      void actions.submit("node");
    });
    await act(async () =>
      graph.patchNodeData("node", {
        generation: {
          submissionKey: state().submissionKey,
          jobId: "job-1",
          status: "generating",
          progress: 60,
        },
      })
    );
    await act(async () => acknowledge({ request_id: "job-1", status: "queued" } as never));
    expect(state()).toMatchObject({ status: "generating", progress: 60 });
    await act(async () => finishJob(job));
    expect(state().status).toBe("done");
  });
  it("keeps recovering a completed receipt when loading its outputs initially fails", async () => {
    vi.useFakeTimers();
    vi.mocked(submitFizzAiJob).mockResolvedValueOnce({
      request_id: "job-1",
      status: "completed",
    } as never);
    vi.mocked(getFizzAiJob).mockRejectedValueOnce(new Error("Offline"));
    await mount();
    await act(async () => actions.submit("node"));
    expect(state()).toMatchObject({ jobId: "job-1", status: "generating" });
    vi.mocked(listFizzAiJobs).mockResolvedValue({ jobs: [job], nextCursor: null });
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(state()).toMatchObject({ status: "done", outputs: [{ assetId: "asset" }] });
    expect(submitFizzAiJob).toHaveBeenCalledTimes(1);
  });
  it("hydrates outputs for a card persisted as done before its output read completed", async () => {
    nodes[0].data.generation = { status: "done", jobId: "job-1" };
    vi.mocked(listFizzAiJobs).mockResolvedValue({ jobs: [job], nextCursor: null });
    await mount();
    expect(state()).toMatchObject({ status: "done", outputs: [{ assetId: "asset" }] });
    expect(listFizzAiJobs).toHaveBeenCalledWith(expect.objectContaining({ ids: ["job-1"] }));
  });
  it("unblocks an old card after a failed lookup recovers and confirms no job exists", async () => {
    vi.useFakeTimers();
    nodes[0].data.generation = { status: "submitting" };
    vi.mocked(listFizzAiJobs).mockRejectedValueOnce(new Error("Offline"));
    await mount();
    expect(state().status).toBe("uncertain");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(state().status).toBe("failed");
    vi.mocked(submitFizzAiJob).mockResolvedValueOnce({
      request_id: "job-1",
      status: "completed",
    } as never);
    await act(async () => actions.submit("node"));
    expect(submitFizzAiJob).toHaveBeenCalledTimes(1);
  });
  it("does not replay another collaborator's unacknowledged paid request", async () => {
    mocks.userId = "collaborator";
    nodes[0].data.generation = {
      status: "uncertain",
      submissionKey: "receipt",
      submissionOwnerId: "owner",
      submission: { idempotencyKey: "receipt", modelId: "wan", input: {} },
    };
    await mount();
    await act(async () => actions.submit("node"));
    expect(submitFizzAiJob).not.toHaveBeenCalled();
    expect(state().submissionKey).toBe("receipt");
  });
  it("restores a submitting card without a job ID after the server completed it", async () => {
    nodes[0].data.generation = { status: "submitting" };
    vi.mocked(listFizzAiJobs).mockResolvedValue({ jobs: [job], nextCursor: null });
    await mount();
    expect(state()).toMatchObject({
      jobId: "job-1",
      status: "done",
      outputs: [{ assetId: "asset" }],
    });
    expect(listFizzAiJobs).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "document", documentBlockId: "node", limit: 1 })
    );
  });
  it("reuses the exact request after a lost response even when the composer was edited", async () => {
    vi.mocked(submitFizzAiJob).mockRejectedValueOnce(
      new ApiRequestError("NETWORK_ERROR", "Network connection failed", 0)
    );
    await mount();
    await act(async () => actions.submit("node"));
    const receipt = state().submission!;
    expect(state().status).toBe("uncertain");
    expect(receipt.idempotencyKey).toBe(state().submissionKey);
    nodes[0].data.prompt = "changed prompt";
    nodes[0].data.modelId = "another-model";
    vi.mocked(submitFizzAiJob).mockResolvedValueOnce({
      request_id: "job-1",
      status: "completed",
    } as never);
    await act(async () => actions.submit("node"));
    expect(vi.mocked(submitFizzAiJob).mock.calls[1][0]).toEqual(receipt);
    expect(state()).toMatchObject({ status: "done", jobId: "job-1" });
    expect(state().submission).toBeUndefined();
  });
  it("accepts only one request for two clicks while submission is in flight", async () => {
    let finish!: (value: never) => void;
    vi.mocked(submitFizzAiJob).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await mount();
    await act(async () => {
      actions.submit("node");
      actions.submit("node");
    });
    expect(submitFizzAiJob).toHaveBeenCalledTimes(1);
    await act(async () => finish({ request_id: "job-1", status: "completed" } as never));
  });
  it("checks active jobs in one batch even when realtime is connected", async () => {
    vi.useFakeTimers();
    mocks.connected = true;
    nodes[0].data.generation = { status: "generating", jobId: "job-1" };
    vi.mocked(listFizzAiJobs).mockResolvedValueOnce({
      jobs: [{ ...job, status: "in_progress", outputs: [] }],
      nextCursor: null,
    });
    await mount();
    vi.mocked(listFizzAiJobs).mockResolvedValue({ jobs: [job], nextCursor: null });
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(state().status).toBe("done");
    expect(listFizzAiJobs).toHaveBeenLastCalledWith(
      expect.objectContaining({ ids: ["job-1"], limit: 100 })
    );
  });
});

describe("duration preflight races", () => {
  it("does not submit or recreate a card deleted while metadata is loading", async () => {
    mocks.fields.mockReturnValue([{ field: "video", kind: "video" }]);
    nodes[0]!.data.references = { video: [{ id: "ref", url: "old.mp4" }] };
    let finish!: (value: number) => void;
    mocks.probe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await mount();
    let pending!: ReturnType<typeof actions.submit>;
    act(() => {
      pending = actions.submit("node");
    });
    expect(mocks.probe).toHaveBeenCalled();
    nodes = [];
    await act(async () => {
      finish(12);
      await pending;
    });
    expect(submitFizzAiJob).not.toHaveBeenCalled();
    expect(nodes).toEqual([]);
  });
});

describe("submission scope ownership", () => {
  it.each(["account", "document", "authority"])(
    "cancels preflight and retained callbacks on %s change",
    async (change) => {
      mocks.fields.mockReturnValue([{ field: "video", kind: "video" }]);
      nodes[0]!.data.references = { video: [{ id: "ref", url: "old.mp4" }] };
      let finish!: (value: number) => void;
      mocks.probe.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      await mount();
      const oldSubmit = actions.submit;
      act(() => oldSubmit("node"));
      const signal = mocks.probe.mock.calls[0][2] as AbortSignal;
      if (change === "account") mocks.userId = "replacement";
      if (change === "document") mocks.documentId = "replacement";
      if (change === "authority") mocks.canGenerate = false;
      await mount();
      expect(signal.aborted).toBe(true);
      await act(async () => {
        finish(12);
      });
      act(() => oldSubmit("node"));
      expect(submitFizzAiJob).not.toHaveBeenCalled();
      expect(mocks.probe).toHaveBeenCalledTimes(1);
    }
  );

  it("suppresses an abandoned failure and preserves a replacement pending claim", async () => {
    let rejectOld!: (error: Error) => void;
    vi.mocked(submitFizzAiJob).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        })
    );
    await mount();
    act(() => actions.submit("node"));
    mocks.userId = "replacement";
    nodes[0]!.data.generation = undefined;
    await mount();
    vi.mocked(submitFizzAiJob).mockImplementationOnce(() => new Promise(() => {}));
    act(() => actions.submit("node"));
    const replacement = state();
    await act(async () => {
      rejectOld(new Error("abandoned"));
    });
    expect(state()).toEqual(replacement);
    act(() => actions.submit("node"));
    expect(submitFizzAiJob).toHaveBeenCalledTimes(2);
  });
});

it("ignores an abandoned acknowledgement before hydration or wallet refresh", async () => {
  let acknowledge!: (value: never) => void;
  vi.mocked(submitFizzAiJob).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      })
  );
  await mount();
  act(() => actions.submit("node"));
  mocks.userId = "replacement";
  nodes[0]!.data.generation = undefined;
  await mount();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await act(async () => {
    acknowledge({ request_id: "old-job", status: "queued" } as never);
  });
  expect(state()).toBeUndefined();
  expect(getFizzAiJob).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
});

describe("recovery and cancellation ownership", () => {
  it("starts replacement recovery without applying a previous viewer's result", async () => {
    let finish!: (value: { jobs: FizzAiJobView[]; nextCursor: null }) => void;
    nodes[0]!.data.generation = { status: "generating", jobId: "job-1" };
    vi.mocked(listFizzAiJobs).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const fetchQuery = vi.spyOn(client, "fetchQuery");
    await mount();
    mocks.userId = "replacement";
    await mount();
    expect(listFizzAiJobs).toHaveBeenCalledTimes(2);
    await act(async () => {
      finish({ jobs: [job], nextCursor: null });
    });
    expect(state().status).toBe("generating");
    const keys = fetchQuery.mock.calls.map(([options]) => options.queryKey);
    expect(keys.some((key) => key[0] === "canvas-jobs" && key[1] === "owner")).toBe(true);
    expect(keys.some((key) => key[0] === "canvas-jobs" && key[1] === "replacement")).toBe(true);
  });

  it("deduplicates cancellation and ignores a late result after account replacement", async () => {
    let finish!: (value: FizzAiJobView) => void;
    nodes[0]!.data.generation = { status: "generating", jobId: "job-1" };
    vi.mocked(cancelFizzAiJob).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await mount();
    const oldCancel = actions.cancel;
    act(() => {
      oldCancel("node");
      oldCancel("node");
    });
    expect(cancelFizzAiJob).toHaveBeenCalledTimes(1);
    mocks.userId = "replacement";
    await mount();
    await act(async () => {
      finish(job);
    });
    expect(state().status).toBe("generating");
    act(() => oldCancel("node"));
    expect(cancelFizzAiJob).toHaveBeenCalledTimes(1);
  });
});

it("shows failed reads for an accepted job and clears after automatic recovery without submission", async () => {
  vi.useFakeTimers();
  mocks.connected = true;
  nodes[0].data.generation = { status: "generating", jobId: "job-1" };
  vi.mocked(listFizzAiJobs).mockRejectedValue(new Error("network unavailable"));
  await mount();
  expect(actions.statusUnavailable("job-1")).toBe(true);
  expect(actions.statusUnavailable("other-job")).toBe(false);
  expect(state()).toMatchObject({ status: "generating", jobId: "job-1" });
  vi.mocked(listFizzAiJobs).mockResolvedValue({ jobs: [job], nextCursor: null });
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(actions.statusUnavailable("job-1")).toBe(false);
  expect(state().status).toBe("done");
  expect(submitFizzAiJob).not.toHaveBeenCalled();
});

it("does not leak failed-read feedback into another document", async () => {
  nodes[0].data.generation = { status: "generating", jobId: "job-1" };
  vi.mocked(listFizzAiJobs).mockRejectedValue(new Error("offline"));
  await mount();
  expect(actions.statusUnavailable("job-1")).toBe(true);
  mocks.documentId = "another-document";
  nodes = [];
  await mount();
  expect(actions.statusUnavailable("job-1")).toBe(false);
  expect(submitFizzAiJob).not.toHaveBeenCalled();
});

it("keeps missing accepted jobs marked unavailable after a successful empty lookup", async () => {
  vi.useFakeTimers();
  mocks.connected = true;
  nodes[0].data.generation = { status: "generating", jobId: "job-1" };
  vi.mocked(listFizzAiJobs).mockResolvedValue({ jobs: [], nextCursor: null });
  await mount();
  expect(actions.statusUnavailable("job-1")).toBe(true);
  expect(state()).toMatchObject({ status: "generating", jobId: "job-1" });
  vi.mocked(listFizzAiJobs).mockResolvedValue({ jobs: [job], nextCursor: null });
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(actions.statusUnavailable("job-1")).toBe(false);
  expect(state().status).toBe("done");
  expect(submitFizzAiJob).not.toHaveBeenCalled();
});

it.each(["first", "second"])(
  "removes only references affected by a blocked %s output",
  async (blocked) => {
    const outputs = ["first", "second"].map((assetId) => ({
      assetId,
      type: "image" as const,
      url: `https://cdn.test/${assetId}.png`,
    }));
    nodes[0].data.generation = { status: "done", jobId: "job-1", outputs };
    const reference = {
      id: "wire",
      edgeId: "wire",
      sourceNodeId: "node",
      assetId: "first",
      url: outputs[0].url,
      kind: "image",
    };
    nodes.push({
      id: "target",
      type: "video",
      position: { x: 1, y: 1 },
      data: {
        references: { referenceImages: [reference] },
        generation: { status: "done", jobId: "target-job", outputs: [outputs[0]] },
      },
    });
    graph.getEdges = () => [{ id: "wire", source: "node", target: "target" }];
    await mount();
    await act(async () =>
      mocks.onEvent({ kind: "media_asset_moderation_changed", action: "blocked", assetId: blocked })
    );
    expect(state().outputs).toEqual(outputs.filter((output) => output.assetId !== blocked));
    expect(graph.removeAssetsByMediaAssetId).toHaveBeenCalledWith(blocked);
    if (blocked === "second") {
      expect(nodes[1].data.references).toEqual({ referenceImages: [reference] });
      expect(graph.removeEdge).not.toHaveBeenCalled();
    } else {
      expect(nodes[1].data.references).toEqual({});
      expect(graph.removeEdge).toHaveBeenCalledWith("wire");
    }
  }
);
