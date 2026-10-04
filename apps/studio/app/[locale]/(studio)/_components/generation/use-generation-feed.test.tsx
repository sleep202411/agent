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
vi.mock("next-intl", () => ({ useTranslations: () => translate }));
const translate = (key: string) => key;
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
  sessionStorage.clear();
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

it("retains a lost-response receipt and blocks edited/new submissions until lookup confirms the original", async () => {
  vi.mocked(submitFizzAiJob).mockRejectedValueOnce(new Error("Response lost"));
  await render();
  await act(async () => {
    await feed.submit(params);
  });
  const original = vi.mocked(submitFizzAiJob).mock.calls[0][0];
  expect(feed.submissionRecovery.pending).toBe(true);
  await act(async () => {
    await feed.submit({ ...params, modelId: "another", input: { prompt: "new" } });
  });
  expect(submitFizzAiJob).toHaveBeenCalledTimes(1);
  await act(async () => feed.submissionRecovery.check());
  expect(feed.submissionRecovery.pending).toBe(true);
  expect(feed.submissionRecovery.error).toBe("notFoundYet");
  expect(submitFizzAiJob).toHaveBeenCalledTimes(1);
  vi.mocked(listFizzAiJobs).mockResolvedValueOnce({
    jobs: [
      {
        ...job,
        id: "accepted",
        status: "queued",
        modelId: original.modelId,
        idempotencyKey: original.idempotencyKey,
      },
    ],
    nextCursor: null,
  });
  await act(async () => feed.submissionRecovery.check());
  expect(feed.submissionRecovery.pending).toBe(false);
  expect(feed.jobs[0].jobId).toBe("accepted");
  expect(submitFizzAiJob).toHaveBeenCalledTimes(1);
});

it("replays only the original reviewed command after returning to the page", async () => {
  vi.mocked(submitFizzAiJob).mockRejectedValueOnce(new Error("Response lost"));
  await render();
  await act(async () => {
    await feed.submit(params);
  });
  const original = vi.mocked(submitFizzAiJob).mock.calls[0][0];
  await act(async () => root.unmount());
  root = createRoot(document.createElement("div"));
  await render();
  expect(feed.submissionRecovery.pending).toBe(true);
  vi.mocked(submitFizzAiJob).mockResolvedValueOnce({
    request_id: "accepted",
    status: "queued",
  } as Awaited<ReturnType<typeof submitFizzAiJob>>);
  await act(async () => feed.submissionRecovery.retryOriginal());
  expect(submitFizzAiJob).toHaveBeenLastCalledWith(original);
  expect(feed.submissionRecovery.pending).toBe(false);
  expect(feed.jobs[0].jobId).toBe("accepted");
});

it.each(["account", "workspace"])(
  "isolates recovery and stale callbacks across %s changes",
  async (change) => {
    vi.mocked(submitFizzAiJob).mockRejectedValueOnce(new Error("Response lost"));
    await render();
    await act(async () => {
      await feed.submit(params);
    });
    const previousRecovery = feed.submissionRecovery;
    if (change === "account") state.user = "other";
    else state.workspace = "other";
    await render();
    expect(feed.submissionRecovery.pending).toBe(false);
    await act(async () => previousRecovery.retryOriginal());
    expect(submitFizzAiJob).toHaveBeenCalledTimes(1);
    state.user = "a";
    state.workspace = "one";
    await render();
    expect(feed.submissionRecovery.pending).toBe(true);
  }
);

it("retains uncertain recovery on lookup failure and does not send an unrecorded request", async () => {
  await render();
  const store = vi
    .spyOn(Object.getPrototypeOf(window.sessionStorage), "setItem")
    .mockImplementation(() => {
      throw new Error("Storage full");
    });
  await act(async () => {
    await feed.submit(params);
  });
  expect(submitFizzAiJob).not.toHaveBeenCalled();
  expect(feed.submissionRecovery.pending).toBe(true);
  store.mockRestore();
  await act(async () => feed.submissionRecovery.check());
  vi.mocked(submitFizzAiJob).mockRejectedValueOnce(new Error("Response lost"));
  await act(async () => {
    await feed.submit(params);
  });
  vi.mocked(listFizzAiJobs).mockRejectedValueOnce(new Error("Lookup unavailable"));
  await act(async () => feed.submissionRecovery.retryOriginal());
  expect(submitFizzAiJob).toHaveBeenCalledTimes(1);
  expect(feed.submissionRecovery.pending).toBe(true);
  expect(feed.submissionRecovery.error).toBe("Lookup unavailable");
});

it("clears a definite rejection for its original owner even after an account switch", async () => {
  const { ApiRequestError } = await import("@/lib/api");
  let reject!: (error: unknown) => void;
  vi.mocked(submitFizzAiJob).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      })
  );
  await render();
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = feed.submit(params);
  });
  state.user = "other";
  await render();
  await act(async () => {
    reject(new ApiRequestError(400, "Invalid prompt", 400));
    await pending;
  });
  state.user = "a";
  await render();
  expect(feed.submissionRecovery.pending).toBe(false);
});
