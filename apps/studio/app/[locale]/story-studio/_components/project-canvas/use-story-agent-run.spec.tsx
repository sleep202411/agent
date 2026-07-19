// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AssetEvent } from "@repo/shared";
import type { StoryAgentRunDto, StoryAgentRunRealtimeEvent } from "@repo/shared/story-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetsRealtimeHandlers } from "@/app/[locale]/canvas/_lib/assets-realtime";
import {
  cancelStoryAgentRun,
  confirmStoryAgentRun,
  getLatestStoryAgentRun,
  getUndoableStoryAgentRun,
  retryStoryAgentRunAuthoring,
  undoStoryAgentRun,
} from "@/lib/story-projects-api";
import {
  storyAgentRunQueryKey,
  storyAgentUndoableRunQueryKey,
  useStoryAgentRun,
  type StoryAgentRunController,
} from "./use-story-agent-run";
import {
  STORY_AGENT_TEST_OTHER_PROJECT_ID,
  STORY_AGENT_TEST_PROJECT_ID,
  STORY_AGENT_TEST_RUN_ID,
  STORY_AGENT_TEST_WORKSPACE_ID,
  storyAgentRunFixture,
} from "./story-agent-run.test-fixtures";

const realtime = vi.hoisted(() => ({
  handlers: null as AssetsRealtimeHandlers | null,
  close: vi.fn(),
  subscribe: vi.fn(),
  getKernel: vi.fn(),
}));

vi.mock("@/app/[locale]/canvas/_lib/assets-realtime-kernel", () => ({
  getAssetsRealtimeKernel: realtime.getKernel,
}));

vi.mock("@/lib/story-projects-api", () => ({
  getLatestStoryAgentRun: vi.fn(),
  getUndoableStoryAgentRun: vi.fn(),
  confirmStoryAgentRun: vi.fn(),
  cancelStoryAgentRun: vi.fn(),
  retryStoryAgentRunAuthoring: vi.fn(),
  undoStoryAgentRun: vi.fn(),
}));

describe("useStoryAgentRun", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let controller: StoryAgentRunController | null;
  let harnessWorkspaceId: string;
  let harnessProjectId: string;

  function Harness() {
    controller = useStoryAgentRun({
      workspaceId: harnessWorkspaceId,
      projectId: harnessProjectId,
    });
    return (
      <span
        data-run-status={controller.run?.status ?? "none"}
        data-authority={controller.authorityState}
        data-applying={String(controller.applying)}
      />
    );
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    controller = null;
    harnessWorkspaceId = STORY_AGENT_TEST_WORKSPACE_ID;
    harnessProjectId = STORY_AGENT_TEST_PROJECT_ID;
    realtime.handlers = null;
    realtime.close.mockReset();
    realtime.subscribe.mockReset();
    realtime.getKernel.mockReset();
    realtime.subscribe.mockImplementation((handlers: AssetsRealtimeHandlers) => {
      realtime.handlers = handlers;
      return { close: realtime.close };
    });
    realtime.getKernel.mockReturnValue({ subscribe: realtime.subscribe });
    vi.mocked(getLatestStoryAgentRun).mockReset().mockResolvedValue(null);
    vi.mocked(getUndoableStoryAgentRun).mockReset().mockResolvedValue(null);
    vi.mocked(confirmStoryAgentRun).mockReset();
    vi.mocked(cancelStoryAgentRun).mockReset();
    vi.mocked(retryStoryAgentRunAuthoring).mockReset();
    vi.mocked(undoStoryAgentRun).mockReset();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false },
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  });

  it("is not authoritative until the canonical active GET succeeds", async () => {
    const pending = deferred<StoryAgentRunDto | null>();
    vi.mocked(getLatestStoryAgentRun).mockReturnValueOnce(pending.promise);

    await mountHarness();
    expect(authority()).toBe("checking");
    expect(currentController().run).toBeNull();

    pending.resolve(storyAgentRunFixture("proposed"));
    await waitFor(() => authority() === "ready");
    expect(runStatus()).toBe("proposed");
    expect("acceptRun" in currentController()).toBe(false);
  });

  it("does not treat a cached run as authority before this mount completes its canonical GET", async () => {
    const cached = storyAgentRunFixture("succeeded");
    queryClient.setQueryData(
      storyAgentRunQueryKey(STORY_AGENT_TEST_WORKSPACE_ID, STORY_AGENT_TEST_PROJECT_ID),
      { run: cached, latchGeneration: 0, authorityGeneration: 0 }
    );
    const pending = deferred<StoryAgentRunDto | null>();
    vi.mocked(getLatestStoryAgentRun).mockReturnValueOnce(pending.promise);

    await mountHarness();
    expect(authority()).toBe("checking");
    expect(currentController().hasAuthoritySnapshot).toBe(false);

    pending.resolve(storyAgentRunFixture("proposed"));
    await waitFor(() => authority() === "ready");
    expect(runStatus()).toBe("proposed");
    expect(currentController().hasAuthoritySnapshot).toBe(true);
  });

  it("does not authorize a cached undoable head before this observer fetches it", async () => {
    const cachedUndoable = storyAgentRunFixture("succeeded");
    queryClient.setQueryData(
      storyAgentUndoableRunQueryKey(STORY_AGENT_TEST_WORKSPACE_ID, STORY_AGENT_TEST_PROJECT_ID),
      cachedUndoable
    );
    const pendingUndoable = deferred<StoryAgentRunDto | null>();
    vi.mocked(getUndoableStoryAgentRun).mockReturnValueOnce(pendingUndoable.promise);

    await mountHarness();
    expect(currentController().undoableRun?.id).toBe(cachedUndoable.id);
    expect(currentController().undoableAuthorityState).toBe("checking");
    expect(currentController().hasUndoableAuthoritySnapshot).toBe(false);

    pendingUndoable.resolve(null);
    await waitFor(() => currentController().undoableAuthorityState === "ready");
    expect(currentController().undoableRun).toBeNull();
    expect(currentController().hasUndoableAuthoritySnapshot).toBe(true);
  });

  it("distinguishes an initial authority failure from a failed background refresh", async () => {
    vi.mocked(getLatestStoryAgentRun).mockRejectedValue(new Error("Authority offline"));
    await mountHarness();
    await waitFor(() => authority() === "error");
    expect(currentController().hasAuthoritySnapshot).toBe(false);
    expect(currentController().run).toBeNull();

    await act(async () => root.unmount());
    queryClient.clear();
    root = createRoot(container);
    controller = null;
    vi.mocked(getLatestStoryAgentRun).mockReset();
    const proposed = storyAgentRunFixture("proposed");
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(proposed);
    await renderHarness();
    const initialAuthoritySnapshotKey = currentController().authoritySnapshotKey;
    expect(currentController().hasAuthoritySnapshot).toBe(true);

    vi.mocked(getLatestStoryAgentRun).mockRejectedValue(new Error("Refresh offline"));
    await expect(currentController().refresh()).rejects.toThrow("Refresh offline");
    await waitFor(() => authority() === "error");
    expect(currentController().hasAuthoritySnapshot).toBe(true);
    expect(currentController().run?.id).toBe(proposed.id);
    expect(currentController().authoritySnapshotKey).toBeNull();

    vi.mocked(getLatestStoryAgentRun).mockReset().mockResolvedValueOnce(proposed);
    await currentController().refresh();
    await waitFor(() => authority() === "ready");
    // Recovery with an unchanged head restores the identical snapshot key.
    // Fail-closed is carried by the key passing through null while authority
    // was lost (which re-arms the projection queries), not by rotating the key
    // on error timestamps — rotation would churn the mounted canvas for no
    // safety gain.
    expect(currentController().authoritySnapshotKey).toBe(initialAuthoritySnapshotKey);
  });

  it("changes projection authority only for a new head, not ordinary polling", async () => {
    const proposed = storyAgentRunFixture("proposed");
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(proposed);
    await renderHarness();
    const initialKey = currentController().authoritySnapshotKey;

    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(proposed);
    await currentController().refresh();
    expect(currentController().authoritySnapshotKey).toBe(initialKey);

    // A metadata-only `updatedAt` bump on the same run head is not a
    // write-relevant transition and must not rotate the projection key.
    const heartbeat = storyAgentRunFixture("proposed", {
      updatedAt: "2026-07-18T13:01:30.000Z",
    });
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(heartbeat);
    await currentController().refresh();
    await waitFor(() => currentController().run?.updatedAt === heartbeat.updatedAt);
    expect(currentController().authoritySnapshotKey).toBe(initialKey);

    const nextHead = storyAgentRunFixture("proposed", {
      id: "00000000-0000-4000-8000-000000000031",
      updatedAt: "2026-07-18T13:02:00.000Z",
    });
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(nextHead);
    await currentController().refresh();
    await waitFor(() => currentController().run?.id === nextHead.id);
    expect(currentController().authoritySnapshotKey).not.toBe(initialKey);
  });

  it("subscribes to the exact Story project scope and closes it on unmount", async () => {
    await renderHarness();

    expect(realtime.getKernel).toHaveBeenCalledWith({
      workspaceId: STORY_AGENT_TEST_WORKSPACE_ID,
      storyProjectId: STORY_AGENT_TEST_PROJECT_ID,
    });
    expect(getLatestStoryAgentRun).toHaveBeenCalledWith(
      STORY_AGENT_TEST_WORKSPACE_ID,
      STORY_AGENT_TEST_PROJECT_ID,
      expect.any(AbortSignal)
    );
    expect(realtime.subscribe).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    expect(realtime.close).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("uses realtime only as an applying latch and canonical refetch trigger", async () => {
    const proposed = storyAgentRunFixture("proposed");
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(proposed);
    await renderHarness();

    const canonicalApplying = deferred<StoryAgentRunDto | null>();
    vi.mocked(getLatestStoryAgentRun).mockReturnValueOnce(canonicalApplying.promise);
    await emitRealtime(storyAgentRunFixture("applying"));

    expect(runStatus()).toBe("proposed");
    expect(applying()).toBe(true);

    canonicalApplying.resolve(storyAgentRunFixture("applying"));
    await waitFor(() => runStatus() === "applying");
    expect(applying()).toBe(true);

    const callsBeforeInvalidEvents = vi.mocked(getLatestStoryAgentRun).mock.calls.length;
    await act(async () => {
      realtime.handlers?.onEvent?.({
        kind: "story_agent_run_changed",
        workspaceId: STORY_AGENT_TEST_WORKSPACE_ID,
        projectId: STORY_AGENT_TEST_PROJECT_ID,
        run: { broken: true },
        ts: Date.now(),
      } as unknown as AssetEvent);
      realtime.handlers?.onEvent?.({
        kind: "story_agent_run_changed",
        workspaceId: STORY_AGENT_TEST_WORKSPACE_ID,
        projectId: STORY_AGENT_TEST_PROJECT_ID,
        run: { ...proposed, projectId: STORY_AGENT_TEST_OTHER_PROJECT_ID },
        ts: Date.now(),
      } as unknown as AssetEvent);
      await Promise.resolve();
    });
    expect(getLatestStoryAgentRun).toHaveBeenCalledTimes(callsBeforeInvalidEvents);
  });

  it("does not let a delayed older active GET replace a newer canonical head", async () => {
    const proposed = storyAgentRunFixture("proposed");
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(proposed);
    await renderHarness();

    const delayedOlderRead = deferred<StoryAgentRunDto | null>();
    vi.mocked(getLatestStoryAgentRun)
      .mockReturnValueOnce(delayedOlderRead.promise)
      .mockResolvedValueOnce(storyAgentRunFixture("applying"));

    const olderRefresh = currentController()
      .refresh()
      .catch(() => null);
    await waitFor(() => vi.mocked(getLatestStoryAgentRun).mock.calls.length >= 2);
    await emitRealtime(storyAgentRunFixture("applying"));
    await waitFor(() => runStatus() === "applying");

    delayedOlderRead.resolve(proposed);
    await olderRefresh;
    await flushQueryObservers();
    expect(runStatus()).toBe("applying");
    expect(applying()).toBe(true);
  });

  it("latches and reconciles a terminal event even when a newer proposal wins the active GET", async () => {
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(storyAgentRunFixture("applying"));
    await renderHarness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const succeeded = storyAgentRunFixture("succeeded");
    const newerProposal = storyAgentRunFixture("proposed", {
      id: "00000000-0000-4000-8000-000000000029",
      updatedAt: "2026-07-18T13:00:00.000Z",
    });
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(newerProposal);

    await emitRealtime(succeeded);
    await waitFor(() => currentController().run?.id === newerProposal.id);

    expect(currentController().projectionTarget?.id).toBe(succeeded.id);
    expect(currentController().projectionTarget?.resultDraftRevision).toBe(
      succeeded.resultDraftRevision
    );

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [
        "story-studio",
        "workbench",
        STORY_AGENT_TEST_WORKSPACE_ID,
        STORY_AGENT_TEST_PROJECT_ID,
      ],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: storyAgentUndoableRunQueryKey(
        STORY_AGENT_TEST_WORKSPACE_ID,
        STORY_AGENT_TEST_PROJECT_ID
      ),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [
        "story-studio",
        "canvas-layout",
        STORY_AGENT_TEST_WORKSPACE_ID,
        STORY_AGENT_TEST_PROJECT_ID,
      ],
    });

    await act(async () => {
      currentController().acknowledgeProjectionTarget(succeeded.id);
    });
    expect(currentController().projectionTarget).toBeNull();
  });

  it("rechecks live authority when an action captured before a slow preflight finally submits", async () => {
    const proposed = storyAgentRunFixture("proposed");
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(proposed);
    await renderHarness();
    const capturedConfirm = currentController().confirm;
    const replacement = storyAgentRunFixture("proposed", {
      id: "00000000-0000-4000-8000-000000000030",
      updatedAt: "2026-07-18T13:01:00.000Z",
    });
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(replacement);
    await currentController().refresh();
    await waitFor(() => currentController().run?.id === replacement.id);

    await expect(capturedConfirm(proposed.id)).rejects.toMatchObject({
      code: "canonicalHeadChanged",
    });
    expect(confirmStoryAgentRun).not.toHaveBeenCalled();
  });

  it("scopes latches, terminal dedupe, and local action errors to one project", async () => {
    const proposed = storyAgentRunFixture("proposed");
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(proposed);
    vi.mocked(confirmStoryAgentRun).mockRejectedValueOnce(new Error("Revision rejected"));
    await renderHarness();

    await expect(currentController().confirm(proposed.id)).rejects.toThrow("Revision rejected");
    await flushQueryObservers();
    expect(currentController().actionError?.runId).toBe(proposed.id);

    const succeeded = storyAgentRunFixture("succeeded");
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(proposed);
    await emitRealtime(succeeded);
    expect(currentController().projectionTarget?.id).toBe(succeeded.id);

    const delayedProjectARefresh = deferred<StoryAgentRunDto | null>();
    vi.mocked(getLatestStoryAgentRun).mockReturnValueOnce(delayedProjectARefresh.promise);
    await emitRealtime(storyAgentRunFixture("applying"));
    expect(currentController().applying).toBe(true);

    harnessProjectId = STORY_AGENT_TEST_OTHER_PROJECT_ID;
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(null);
    await mountHarness();
    expect(currentController().projectionTarget).toBeNull();
    expect(currentController().actionError).toBeNull();
    expect(currentController().applying).toBe(false);
    await waitFor(() => authority() === "ready");

    const projectBSucceeded = storyAgentRunFixture("succeeded", {
      projectId: STORY_AGENT_TEST_OTHER_PROJECT_ID,
    });
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(null);
    await emitRealtime(projectBSucceeded);
    expect(currentController().projectionTarget?.projectId).toBe(STORY_AGENT_TEST_OTHER_PROJECT_ID);

    delayedProjectARefresh.resolve(proposed);
    await flushQueryObservers();
    expect(currentController().projectionTarget?.projectId).toBe(STORY_AGENT_TEST_OTHER_PROJECT_ID);
  });

  it("refetches canonical run state whenever realtime reconnects", async () => {
    await renderHarness();
    expect(getLatestStoryAgentRun).toHaveBeenCalledTimes(1);
    expect(getUndoableStoryAgentRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      realtime.handlers?.onConnected?.();
      await Promise.resolve();
    });
    await waitFor(() => vi.mocked(getLatestStoryAgentRun).mock.calls.length === 2);
    expect(getUndoableStoryAgentRun).toHaveBeenCalledTimes(2);
  });

  it("fails closed immediately on disconnect and recovers only from a post-disconnect GET", async () => {
    await renderHarness();
    const initialProjectionKey = currentController().authoritySnapshotKey;
    const recovery = deferred<StoryAgentRunDto | null>();
    vi.mocked(getLatestStoryAgentRun).mockReturnValueOnce(recovery.promise);

    await act(async () => {
      realtime.handlers?.onDisconnected?.("network_lost");
      await Promise.resolve();
    });

    expect(authority()).toBe("checking");
    expect(currentController().authoritySnapshotKey).toBeNull();

    recovery.resolve(null);
    await waitFor(() => authority() === "ready");
    expect(currentController().authoritySnapshotKey).not.toBe(initialProjectionKey);
  });

  it("confirms only the canonical proposal and waits for active GET to advance the head", async () => {
    const proposed = storyAgentRunFixture("proposed");
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(proposed);
    await renderHarness();
    const applyingRun = storyAgentRunFixture("applying");
    vi.mocked(confirmStoryAgentRun).mockResolvedValueOnce(applyingRun);
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(applyingRun);

    await act(async () => {
      await currentController().confirm(proposed.id);
    });
    await waitFor(() => runStatus() === "applying");

    expect(confirmStoryAgentRun).toHaveBeenCalledWith(
      STORY_AGENT_TEST_WORKSPACE_ID,
      STORY_AGENT_TEST_PROJECT_ID,
      STORY_AGENT_TEST_RUN_ID,
      `story-agent-confirm:${STORY_AGENT_TEST_RUN_ID}`
    );
    await expect(
      currentController().confirm(STORY_AGENT_TEST_OTHER_PROJECT_ID)
    ).rejects.toMatchObject({ code: "canonicalHeadChanged" });
    expect(confirmStoryAgentRun).toHaveBeenCalledTimes(1);
  });

  it("cancels the canonical proposal without accepting the mutation response as head", async () => {
    const proposed = storyAgentRunFixture("proposed");
    const cancelled = storyAgentRunFixture("cancelled");
    vi.mocked(getLatestStoryAgentRun)
      .mockResolvedValueOnce(proposed)
      .mockResolvedValueOnce(cancelled);
    vi.mocked(cancelStoryAgentRun).mockResolvedValueOnce(cancelled);
    await renderHarness();

    await act(async () => {
      await currentController().cancel(proposed.id);
    });
    await waitFor(() => runStatus() === "cancelled");
    expect(cancelStoryAgentRun).toHaveBeenCalledWith(
      STORY_AGENT_TEST_WORKSPACE_ID,
      STORY_AGENT_TEST_PROJECT_ID,
      proposed.id
    );
  });

  it("does not raise the applying latch for authoring lifecycle events", async () => {
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(null);
    await renderHarness();

    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(storyAgentRunFixture("authoring"));
    await emitRealtime(storyAgentRunFixture("authoring"));

    await waitFor(() => runStatus() === "authoring");
    expect(applying()).toBe(false);
    expect(authority()).toBe("ready");
  });

  it("re-arms drafting for the canonical authoring_failed head without a write latch", async () => {
    const failed = storyAgentRunFixture("authoring_failed");
    const authoring = storyAgentRunFixture("authoring");
    vi.mocked(getLatestStoryAgentRun)
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(authoring);
    vi.mocked(retryStoryAgentRunAuthoring).mockResolvedValueOnce(authoring);
    await renderHarness();

    await act(async () => {
      await currentController().retryAuthoring(failed.id);
    });
    await waitFor(() => runStatus() === "authoring");

    expect(retryStoryAgentRunAuthoring).toHaveBeenCalledWith(
      STORY_AGENT_TEST_WORKSPACE_ID,
      STORY_AGENT_TEST_PROJECT_ID,
      failed.id
    );
    expect(applying()).toBe(false);
  });

  it("rejects retryAuthoring when the canonical head is not in an authoring phase", async () => {
    const proposed = storyAgentRunFixture("proposed");
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(proposed);
    await renderHarness();

    await expect(currentController().retryAuthoring(proposed.id)).rejects.toMatchObject({
      code: "runNotRetryable",
    });
    expect(retryStoryAgentRunAuthoring).not.toHaveBeenCalled();
  });

  it("binds a failed drafting retry to its run and surfaces it as an action error", async () => {
    const failed = storyAgentRunFixture("authoring_failed");
    vi.mocked(getLatestStoryAgentRun).mockResolvedValue(failed);
    vi.mocked(retryStoryAgentRunAuthoring).mockRejectedValueOnce(
      new Error("STORY_AGENT_RUN_NOT_RETRYABLE")
    );
    await renderHarness();

    await expect(currentController().retryAuthoring(failed.id)).rejects.toThrow(
      "STORY_AGENT_RUN_NOT_RETRYABLE"
    );
    await flushQueryObservers();
    expect(currentController().actionError).toMatchObject({
      runId: failed.id,
      action: "retryAuthoring",
      status: "authoring_failed",
    });
  });

  it("cancels an authoring-phase run without requiring the proposed status", async () => {
    const authoring = storyAgentRunFixture("authoring");
    const cancelled = storyAgentRunFixture("cancelled");
    vi.mocked(getLatestStoryAgentRun)
      .mockResolvedValueOnce(authoring)
      .mockResolvedValueOnce(cancelled);
    vi.mocked(cancelStoryAgentRun).mockResolvedValueOnce(cancelled);
    await renderHarness();

    await act(async () => {
      await currentController().cancel(authoring.id);
    });
    await waitFor(() => runStatus() === "cancelled");
    expect(cancelStoryAgentRun).toHaveBeenCalledWith(
      STORY_AGENT_TEST_WORKSPACE_ID,
      STORY_AGENT_TEST_PROJECT_ID,
      authoring.id
    );
  });

  it("creates grouped Undo from the canonical succeeded apply run", async () => {
    const succeeded = storyAgentRunFixture("succeeded");
    const undoApplying = storyAgentRunFixture("applying", {
      id: "00000000-0000-4000-8000-000000000008",
      kind: "undo",
      undoOfRunId: succeeded.id,
    });
    vi.mocked(getLatestStoryAgentRun)
      .mockResolvedValueOnce(succeeded)
      .mockResolvedValueOnce(succeeded)
      .mockResolvedValueOnce(undoApplying);
    vi.mocked(getUndoableStoryAgentRun)
      .mockResolvedValueOnce(succeeded)
      .mockResolvedValueOnce(succeeded)
      .mockResolvedValueOnce(succeeded)
      .mockResolvedValueOnce(null);
    vi.mocked(undoStoryAgentRun).mockResolvedValueOnce(undoApplying);
    await renderHarness();

    await act(async () => {
      await currentController().undo(succeeded.id);
    });
    await waitFor(() => currentController().run?.id === undoApplying.id);
    expect(undoStoryAgentRun).toHaveBeenCalledWith(
      STORY_AGENT_TEST_WORKSPACE_ID,
      STORY_AGENT_TEST_PROJECT_ID,
      succeeded.id,
      `story-agent-undo:${succeeded.id}`
    );
  });

  it("undoes a prior apply after a later cancelled lifecycle run", async () => {
    const applied = storyAgentRunFixture("succeeded");
    const cancelled = storyAgentRunFixture("cancelled", {
      id: "00000000-0000-4000-8000-000000000032",
      updatedAt: "2026-07-18T13:03:00.000Z",
    });
    const undoApplying = storyAgentRunFixture("applying", {
      id: "00000000-0000-4000-8000-000000000033",
      kind: "undo",
      undoOfRunId: applied.id,
    });
    vi.mocked(getLatestStoryAgentRun)
      .mockResolvedValueOnce(cancelled)
      .mockResolvedValueOnce(cancelled)
      .mockResolvedValueOnce(undoApplying);
    vi.mocked(getUndoableStoryAgentRun)
      .mockResolvedValueOnce(applied)
      .mockResolvedValueOnce(applied)
      .mockResolvedValueOnce(null);
    vi.mocked(undoStoryAgentRun).mockResolvedValueOnce(undoApplying);
    await renderHarness();
    await waitFor(() => currentController().undoableAuthorityState === "ready");

    await act(async () => {
      await currentController().undo(applied.id);
    });

    expect(undoStoryAgentRun).toHaveBeenCalledWith(
      STORY_AGENT_TEST_WORKSPACE_ID,
      STORY_AGENT_TEST_PROJECT_ID,
      applied.id,
      `story-agent-undo:${applied.id}`
    );
  });

  it("rechecks both heads and rejects Undo when a proposal wins or the data head is gone", async () => {
    const applied = storyAgentRunFixture("succeeded");
    const cancelled = storyAgentRunFixture("cancelled", {
      id: "00000000-0000-4000-8000-000000000034",
    });
    const proposed = storyAgentRunFixture("proposed", {
      id: "00000000-0000-4000-8000-000000000035",
    });
    vi.mocked(getLatestStoryAgentRun)
      .mockResolvedValueOnce(cancelled)
      .mockResolvedValueOnce(proposed);
    vi.mocked(getUndoableStoryAgentRun)
      .mockResolvedValueOnce(applied)
      .mockResolvedValueOnce(applied);
    await renderHarness();
    await waitFor(() => currentController().undoableAuthorityState === "ready");

    await expect(currentController().undo(applied.id)).rejects.toMatchObject({
      code: "undoBlockedByActiveRun",
    });
    expect(undoStoryAgentRun).not.toHaveBeenCalled();

    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(cancelled);
    vi.mocked(getUndoableStoryAgentRun).mockResolvedValueOnce(null);
    await expect(currentController().undo(applied.id)).rejects.toMatchObject({
      code: "undoHeadChanged",
    });
    expect(undoStoryAgentRun).not.toHaveBeenCalled();
  });

  it("binds an action failure to its run, attempt, and status, then clears on canonical advance", async () => {
    const proposed = storyAgentRunFixture("proposed");
    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(proposed);
    vi.mocked(confirmStoryAgentRun).mockRejectedValueOnce(new Error("Revision rejected"));
    await renderHarness();

    await expect(currentController().confirm(proposed.id)).rejects.toThrow("Revision rejected");
    await flushQueryObservers();
    expect(currentController().actionError).toMatchObject({
      runId: proposed.id,
      action: "confirm",
      attempt: 1,
      status: "proposed",
      error: expect.objectContaining({ message: "Revision rejected" }),
    });

    vi.mocked(getLatestStoryAgentRun).mockResolvedValueOnce(storyAgentRunFixture("applying"));
    await currentController().refresh();
    await waitFor(() => runStatus() === "applying");
    expect(currentController().actionError).toBeNull();
  });

  async function mountHarness() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>
      );
      await Promise.resolve();
    });
  }

  async function renderHarness() {
    await mountHarness();
    await waitFor(() => authority() !== "checking");
  }

  async function emitRealtime(run: ReturnType<typeof storyAgentRunFixture>) {
    const event: StoryAgentRunRealtimeEvent = {
      kind: "story_agent_run_changed",
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      run,
      ts: Date.now(),
    };
    await act(async () => {
      realtime.handlers?.onEvent?.(event as AssetEvent);
      await Promise.resolve();
    });
    await flushQueryObservers();
  }

  async function flushQueryObservers() {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }

  async function waitFor(predicate: () => boolean) {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (predicate()) return;
      await flushQueryObservers();
    }
    throw new Error("Timed out waiting for hook state.");
  }

  function currentController(): StoryAgentRunController {
    if (!controller) throw new Error("Story Agent run controller was not mounted.");
    return controller;
  }

  function runStatus(): string {
    return (
      container.querySelector("[data-run-status]")?.getAttribute("data-run-status") ?? "missing"
    );
  }

  function authority(): string {
    return container.querySelector("[data-authority]")?.getAttribute("data-authority") ?? "missing";
  }

  function applying(): boolean {
    return container.querySelector("[data-applying]")?.getAttribute("data-applying") === "true";
  }
});

describe("storyAgentRunQueryKey", () => {
  it("isolates cache state by both workspace and Story project", () => {
    expect(
      storyAgentRunQueryKey(STORY_AGENT_TEST_WORKSPACE_ID, STORY_AGENT_TEST_PROJECT_ID)
    ).toEqual([
      "story-studio",
      "agent-run",
      STORY_AGENT_TEST_WORKSPACE_ID,
      STORY_AGENT_TEST_PROJECT_ID,
    ]);
  });

  it("isolates undoable authority by workspace and Story project", () => {
    expect(
      storyAgentUndoableRunQueryKey(STORY_AGENT_TEST_WORKSPACE_ID, STORY_AGENT_TEST_PROJECT_ID)
    ).toEqual([
      "story-studio",
      "agent-run-undoable",
      STORY_AGENT_TEST_WORKSPACE_ID,
      STORY_AGENT_TEST_PROJECT_ID,
    ]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
