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
  submitFizzAiJob,
  getFizzAiJob,
  listFizzAiJobs,
  type FizzAiCatalog,
  type FizzAiJobView,
  type GenerationState,
} from "./generation-api";

const mocks = vi.hoisted(() => ({ getGraph: vi.fn(), connected: false, userId: "owner" }));
vi.mock("@/lib/canvas-core/canvas-graph-context", () => ({
  useCanvasGraphContext: mocks.getGraph,
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
    subscribe: (callbacks: { onConnected: () => void }) => {
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
  submitFizzAiJob: vi.fn(),
  getFizzAiJob: vi.fn(),
  listFizzAiJobs: vi.fn(),
  promptRequired: () => false,
  referenceFieldsForMode: () => [],
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
      <CanvasGenerationProvider catalog={catalog} context={context} projectSkills={projectSkills}>
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
  mocks.connected = false;
  mocks.userId = "owner";
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
