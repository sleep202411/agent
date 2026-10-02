// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGenerationFeed, type SubmitFeedJob } from "./use-generation-feed";
import {
  getFizzAiJob,
  listFizzAiJobs,
  submitFizzAiJob,
  retryFizzAiJob,
  type FizzAiJobView,
} from "@/lib/canvas-authoring/generation-api";
const state = vi.hoisted(() => ({
  user: "a",
  workspace: "one",
  callbacks: [] as { onConnected: () => void; onEvent: (event: unknown) => void }[],
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: state.user } }),
}));
vi.mock("@/app/[locale]/project/_components/project-context", () => ({
  useProjectPayerWorkspace: () => ({ id: state.workspace }),
}));
vi.mock("@/lib/canvas-authoring/assets-realtime-kernel", () => ({
  getAssetsRealtimeKernel: () => ({
    subscribe: (callbacks: { onConnected: () => void; onEvent: (event: unknown) => void }) => {
      state.callbacks.push(callbacks);
      return { close: vi.fn() };
    },
  }),
}));
vi.mock("@/app/_components/credits-badge", () => ({ computeWalletBalanceQueryKey: ["wallet"] }));
vi.mock("@/app/[locale]/(studio)/characters/_lib/use-characters", () => ({
  charactersKeys: { detail: () => [], lists: () => [] },
}));
vi.mock("@/lib/canvas-authoring/generation-api", async (original) => ({
  ...(await original<typeof import("@/lib/canvas-authoring/generation-api")>()),
  getFizzAiJob: vi.fn(),
  listFizzAiJobs: vi.fn(),
  submitFizzAiJob: vi.fn(),
  retryFizzAiJob: vi.fn(),
}));
let root: Root;
let client: QueryClient;
let feed: ReturnType<typeof useGenerationFeed>;
const job = {
  id: "old",
  status: "failed",
  createdAt: "2026-01-01",
  modelId: "model",
  input: {},
  outputs: [],
} as unknown as FizzAiJobView;
const params: SubmitFeedJob = { prompt: "hello", modelId: "model", schemaVersion: "1", input: {} };
function Harness() {
  const current = useGenerationFeed("image", "home");
  useLayoutEffect(() => {
    feed = current;
  }, [current]);
  return null;
}
const render = () =>
  act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    )
  );
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.callbacks = [];
  state.user = "a";
  state.workspace = "one";
  vi.mocked(listFizzAiJobs).mockResolvedValue({ jobs: [], nextCursor: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each(["account", "workspace"])("discards delayed history on %s change", async (change) => {
  let finish!: (value: { jobs: FizzAiJobView[]; nextCursor: null }) => void;
  vi.mocked(listFizzAiJobs).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  if (change === "account") state.user = "b";
  else state.workspace = "two";
  await render();
  await act(async () => finish({ jobs: [job], nextCursor: null }));
  expect(feed.jobs).toEqual([]);
  expect(feed.historyLoading).toBe(false);
  expect(listFizzAiJobs).toHaveBeenCalledTimes(2);
});
it("discards delayed submit results and rejects callbacks from a previous account epoch", async () => {
  let finish!: (value: never) => void;
  vi.mocked(submitFizzAiJob).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const oldSubmit = feed.submit;
  let pending!: ReturnType<typeof oldSubmit>;
  await act(async () => {
    pending = oldSubmit(params);
  });
  state.user = "b";
  await render();
  state.user = "a";
  await render();
  await act(async () => {
    finish({ request_id: "old", status: "queued" } as never);
    expect(await pending).toEqual({ ok: false });
  });
  expect(await oldSubmit(params)).toEqual({ ok: false });
  expect(feed.jobs).toEqual([]);
  expect(submitFizzAiJob).toHaveBeenCalledTimes(1);
});
it("deduplicates retries and drops old retry results after replacement", async () => {
  vi.mocked(listFizzAiJobs).mockResolvedValueOnce({ jobs: [job], nextCursor: null });
  await render();
  let finish!: (value: never) => void;
  vi.mocked(retryFizzAiJob).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  let pending!: Promise<void>;
  const row = feed.jobs[0];
  await act(async () => {
    pending = feed.retry(row);
    await feed.retry(row);
  });
  expect(retryFizzAiJob).toHaveBeenCalledTimes(1);
  state.user = "b";
  await render();
  await act(async () => {
    finish({ request_id: "retry", status: "queued" } as never);
    await pending;
  });
  expect(feed.jobs).toEqual([]);
});

it("does not reconcile from a closed realtime subscription", async () => {
  await render();
  const old = state.callbacks[0];
  state.user = "b";
  await render();
  const count = vi.mocked(listFizzAiJobs).mock.calls.length;
  await act(async () => old.onConnected());
  expect(listFizzAiJobs).toHaveBeenCalledTimes(count);
});

it("ignores old polling results after an account change", async () => {
  vi.useFakeTimers();
  vi.mocked(listFizzAiJobs).mockResolvedValueOnce({
    jobs: [{ ...job, status: "in_progress" }],
    nextCursor: null,
  });
  let finish!: (value: FizzAiJobView) => void;
  vi.mocked(getFizzAiJob).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(getFizzAiJob).toHaveBeenCalledTimes(1);
  state.user = "b";
  await render();
  await act(async () => finish(job));
  expect(feed.jobs).toEqual([]);
});

it.each(["queued", "running"])(
  "keeps completed outputs visible after a late %s update",
  async (status) => {
    const completed = {
      ...job,
      status: "completed",
      type: "image",
      sourceSurface: "home",
      outputs: [1, 2].map((n) => ({
        id: `output-${n}`,
        type: "image",
        url: `https://cdn.test/${n}.png`,
      })),
    } as FizzAiJobView;
    vi.mocked(listFizzAiJobs).mockResolvedValueOnce({ jobs: [completed], nextCursor: null });
    await render();
    expect(feed.jobs[0].status).toBe("done");
    await act(async () =>
      state.callbacks.at(-1)!.onEvent({
        kind: "ai_job_update",
        job: { ...completed, status, outputs: [] },
      })
    );
    expect(feed.jobs[0].status).toBe("done");
    expect(feed.jobs[0].outputs).toEqual(completed.outputs);
    expect(feed.hasActiveJobs).toBe(false);
  }
);

it("shows history failures and recovers without submitting or retrying a generation", async () => {
  vi.mocked(listFizzAiJobs).mockRejectedValueOnce(new Error("History temporarily unavailable"));
  await render();
  expect(feed.historyError).toBe("History temporarily unavailable");
  vi.mocked(listFizzAiJobs).mockResolvedValueOnce({ jobs: [job], nextCursor: null });
  await act(async () => {
    await feed.refreshHistory();
  });
  expect(feed.historyError).toBeNull();
  expect(feed.jobs).toHaveLength(1);
  expect(submitFizzAiJob).not.toHaveBeenCalled();
  expect(retryFizzAiJob).not.toHaveBeenCalled();
});

it("clears history errors when the account changes", async () => {
  vi.mocked(listFizzAiJobs).mockRejectedValueOnce(new Error("Private workspace error"));
  await render();
  expect(feed.historyError).toBeTruthy();
  state.user = "replacement";
  await render();
  expect(feed.historyError).toBeNull();
});
