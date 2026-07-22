"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  StoryAgentRunDtoSchema,
  type StoryAgentRunDto,
  type StoryAgentRunStatus,
} from "@repo/shared/story-agent";
import { getAssetsRealtimeKernel } from "@/app/[locale]/canvas/_lib/assets-realtime-kernel";
import {
  cancelStoryAgentRun,
  confirmStoryAgentRun,
  getLatestStoryAgentRun,
  getUndoableStoryAgentRun,
  retryStoryAgentRunAuthoring,
  undoStoryAgentRun,
} from "@/lib/story-projects-api";

const APPLYING_POLL_MS = 1_000;
const PROPOSED_POLL_MS = 5_000;
// Fallback cadence while the realtime socket is not reporting connected (or the
// authority generation is catching up). This is a steady-state rate that can run
// for the whole session in environments where the WebSocket never opens, so it
// stays gentle rather than hammering — realtime is the fast path, this is backup.
const DISCONNECTED_POLL_MS = 3_000;

/**
 * Server-side drafting holds no write fence, but its brief-carrying run can be
 * cancelled at any point and an authoring_failed run can be re-armed.
 */
const CANCELLABLE_RUN_STATUSES: ReadonlySet<StoryAgentRunStatus> = new Set([
  "proposed",
  "authoring",
  "authoring_failed",
]);
const RETRYABLE_AUTHORING_STATUSES: ReadonlySet<StoryAgentRunStatus> = new Set([
  "authoring",
  "authoring_failed",
]);

export type StoryAgentRunAuthorityState = "checking" | "ready" | "error";
export type StoryAgentRunAction = "confirm" | "cancel" | "undo" | "retryAuthoring";
export type StoryAgentProjectionTarget = StoryAgentRunDto;

export type StoryAgentRunActionGuardErrorCode =
  | "projectScopeChanged"
  | "canonicalHeadChanged"
  | "runNotProposed"
  | "runNotRetryable"
  | "undoBlockedByActiveRun"
  | "undoHeadChanged"
  | "authorityUnavailable";

export class StoryAgentRunActionGuardError extends Error {
  readonly name = "StoryAgentRunActionGuardError";

  constructor(
    readonly code: StoryAgentRunActionGuardErrorCode,
    readonly detail?: string
  ) {
    super(code);
  }
}

export function storyAgentRunActionGuardErrorCode(
  error: unknown
): StoryAgentRunActionGuardErrorCode | null {
  return error instanceof StoryAgentRunActionGuardError ? error.code : null;
}

export interface StoryAgentRunActionError {
  runId: string;
  action: StoryAgentRunAction;
  attempt: number;
  status: StoryAgentRunStatus;
  canonicalUpdatedAt: string;
  error: unknown;
}

interface CanonicalStoryAgentRunSnapshot {
  run: StoryAgentRunDto | null;
  /** Lock latch generation observed when this canonical request started. */
  latchGeneration: number;
  /** Realtime recovery generation observed when this canonical request started. */
  authorityGeneration: number;
}

interface StoryAgentRunLockLatch {
  scopeKey: string;
  runId: string;
  generation: number;
}

interface ScopedStoryAgentProjectionTarget {
  scopeKey: string;
  run: StoryAgentProjectionTarget;
}

interface ScopedStoryAgentRunActionError {
  scopeKey: string;
  value: StoryAgentRunActionError;
}

interface StoryAgentRunMutationVariables {
  scopeKey: string;
  workspaceId: string;
  projectId: string;
  runId: string;
  status: StoryAgentRunStatus;
  canonicalUpdatedAt: string;
  attempt: number;
}

export function storyAgentRunQueryKey(
  workspaceId: string | null,
  projectId: string,
  chapterId: string | null
) {
  return ["story-studio", "agent-run", workspaceId, projectId, chapterId ?? "default"] as const;
}

export function storyAgentUndoableRunQueryKey(
  workspaceId: string | null,
  projectId: string,
  chapterId: string | null
) {
  return [
    "story-studio",
    "agent-run-undoable",
    workspaceId,
    projectId,
    chapterId ?? "default",
  ] as const;
}

export function useStoryAgentRun({
  workspaceId,
  projectId,
  chapterId,
}: {
  workspaceId: string | null;
  projectId: string;
  chapterId: string | null;
}) {
  const queryClient = useQueryClient();
  const scopeKey = `${workspaceId ?? "no-workspace"}:${projectId}:${chapterId ?? "default"}`;
  const activeScopeRef = useRef(scopeKey);
  const latchGenerationRef = useRef(0);
  const authorityGenerationRef = useRef(0);
  const actionAttemptRef = useRef(0);
  const latestActionAttemptRef = useRef(0);
  const observedTerminalKeysRef = useRef(new Set<string>());
  const [lockLatch, setLockLatch] = useState<StoryAgentRunLockLatch | null>(null);
  const [requiredAuthorityGeneration, setRequiredAuthorityGeneration] = useState(0);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [latchedProjectionTarget, setLatchedProjectionTarget] =
    useState<ScopedStoryAgentProjectionTarget | null>(null);
  const [actionError, setActionError] = useState<ScopedStoryAgentRunActionError | null>(null);
  const queryKey = useMemo(
    () => storyAgentRunQueryKey(workspaceId, projectId, chapterId),
    [chapterId, projectId, workspaceId]
  );
  const undoableQueryKey = useMemo(
    () => storyAgentUndoableRunQueryKey(workspaceId, projectId, chapterId),
    [chapterId, projectId, workspaceId]
  );
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<CanonicalStoryAgentRunSnapshot> => {
      // Capture both generations before the request starts. A response that was
      // already in flight when an applying event or transport disconnect arrived
      // can present data, but it must never release either fail-closed latch.
      const latchGeneration = latchGenerationRef.current;
      const authorityGeneration = authorityGenerationRef.current;
      return {
        run: await getLatestStoryAgentRun(
          workspaceId as string,
          projectId,
          chapterId ?? undefined,
          signal
        ),
        latchGeneration,
        authorityGeneration,
      };
    },
    enabled: Boolean(workspaceId),
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: ({ state }) => {
      if (
        !realtimeConnected ||
        (state.data?.authorityGeneration ?? -1) < requiredAuthorityGeneration
      ) {
        return DISCONNECTED_POLL_MS;
      }
      if (state.data?.run?.status === "applying") return APPLYING_POLL_MS;
      // Authoring lands proposed operations (or a failure) server-side; poll as
      // a realtime fallback exactly like an open proposal awaiting review.
      if (state.data?.run?.status === "proposed" || state.data?.run?.status === "authoring") {
        return PROPOSED_POLL_MS;
      }
      return false;
    },
  });
  const undoableQuery = useQuery({
    queryKey: undoableQueryKey,
    queryFn: ({ signal }) =>
      getUndoableStoryAgentRun(workspaceId as string, projectId, chapterId ?? undefined, signal),
    enabled: Boolean(workspaceId),
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: ({ state }) => (state.data ? PROPOSED_POLL_MS : false),
  });
  const canonicalRun = query.data?.run ?? null;
  const undoableRun = undoableQuery.data ?? null;
  // React Query can synchronously expose an old cache entry while this mount's
  // canonical GET is still in flight. That entry is presentation cache, not
  // write-lock authority: require one fetch attempt from this observer before
  // unlocking the project.
  const hasCurrentAuthorityGeneration =
    (query.data?.authorityGeneration ?? -1) >= requiredAuthorityGeneration;
  const authorityState: StoryAgentRunAuthorityState = !query.isFetchedAfterMount
    ? "checking"
    : query.isError
      ? "error"
      : query.isSuccess && hasCurrentAuthorityGeneration
        ? "ready"
        : "checking";
  const undoableAuthorityState: StoryAgentRunAuthorityState = !undoableQuery.isFetchedAfterMount
    ? "checking"
    : undoableQuery.isError
      ? "error"
      : undoableQuery.isSuccess
        ? "ready"
        : "checking";
  const authoritySnapshotKey =
    authorityState === "ready"
      ? storyAgentAuthoritySnapshotKey(
          canonicalRun,
          query.data?.authorityGeneration ?? requiredAuthorityGeneration
        )
      : null;
  const canonicalRunRef = useRef<StoryAgentRunDto | null>(canonicalRun);
  const authorityStateRef = useRef<StoryAgentRunAuthorityState>(authorityState);
  const refetchCanonical = query.refetch;
  const refetchUndoable = undoableQuery.refetch;

  useEffect(() => {
    activeScopeRef.current = scopeKey;
    latchGenerationRef.current = 0;
    authorityGenerationRef.current = 0;
    actionAttemptRef.current = 0;
    latestActionAttemptRef.current = 0;
    observedTerminalKeysRef.current.clear();
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLockLatch((current) => (current?.scopeKey === scopeKey ? current : null));
      setRequiredAuthorityGeneration(0);
      setRealtimeConnected(false);
      setLatchedProjectionTarget((current) => (current?.scopeKey === scopeKey ? current : null));
      setActionError((current) => (current?.scopeKey === scopeKey ? current : null));
    });
    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  useEffect(() => {
    canonicalRunRef.current = canonicalRun;
    authorityStateRef.current = authorityState;
  }, [authorityState, canonicalRun]);

  const refreshHeads = useCallback(async () => {
    if (!workspaceId) return null;
    // Abort older GETs before issuing the paired authority read. Both APIs
    // consume TanStack Query's signal, so delayed responses cannot replace the
    // active lifecycle head or the undoable data head.
    await Promise.all([
      queryClient.cancelQueries({ queryKey, exact: true }),
      queryClient.cancelQueries({ queryKey: undoableQueryKey, exact: true }),
    ]);
    const [activeResult, undoableResult] = await Promise.all([
      refetchCanonical({ cancelRefetch: true }),
      refetchUndoable({ cancelRefetch: true }),
    ]);
    if (activeResult.error) throw activeResult.error;
    if (undoableResult.error) throw undoableResult.error;
    return {
      active: activeResult.data?.run ?? null,
      undoable: undoableResult.data ?? null,
    };
  }, [queryClient, queryKey, refetchCanonical, refetchUndoable, undoableQueryKey, workspaceId]);

  const refresh = useCallback(async (): Promise<StoryAgentRunDto | null> => {
    const heads = await refreshHeads();
    return heads?.active ?? null;
  }, [refreshHeads]);

  const requireFreshAuthorityRead = useCallback(() => {
    if (activeScopeRef.current !== scopeKey) return;
    const generation = authorityGenerationRef.current + 1;
    authorityGenerationRef.current = generation;
    setRequiredAuthorityGeneration(generation);
  }, [scopeKey]);

  const refreshProjectState = useCallback(() => {
    if (!workspaceId) return;
    void queryClient.invalidateQueries({
      queryKey: ["story-studio", "workbench", workspaceId, projectId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["story-studio", "canvas-layout", workspaceId, projectId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["story-studio", "current-release", workspaceId, projectId],
    });
    void queryClient.invalidateQueries({
      queryKey: storyAgentUndoableRunQueryKey(workspaceId, projectId, chapterId),
      exact: true,
    });
  }, [chapterId, projectId, queryClient, workspaceId]);

  const latchProjectionTarget = useCallback(
    (run: StoryAgentRunDto) => {
      if (
        activeScopeRef.current !== scopeKey ||
        run.status !== "succeeded" ||
        run.resultDraftRevision === null ||
        run.resultLayoutRevision === null
      ) {
        return;
      }
      setLatchedProjectionTarget((current) => ({
        scopeKey,
        run: newerProjectionTarget(
          current?.scopeKey === scopeKey ? current.run : null,
          run
        ) as StoryAgentProjectionTarget,
      }));
    },
    [scopeKey]
  );

  const observeTerminalRun = useCallback(
    (run: StoryAgentRunDto) => {
      if (activeScopeRef.current !== scopeKey) return;
      if (!isTerminalStoryAgentRun(run)) return;
      const terminalKey = `${run.id}:${run.status}:${run.updatedAt}`;
      if (observedTerminalKeysRef.current.has(terminalKey)) return;
      observedTerminalKeysRef.current.add(terminalKey);
      if (observedTerminalKeysRef.current.size > 64) {
        const oldest = observedTerminalKeysRef.current.values().next().value;
        if (oldest) observedTerminalKeysRef.current.delete(oldest);
      }
      latchProjectionTarget(run);
      // Invalidate from the validated event/run itself. The active-run GET may
      // legitimately advance to a newer proposal before it returns, but that
      // must never erase reconciliation of this committed result.
      refreshProjectState();
    },
    [latchProjectionTarget, refreshProjectState, scopeKey]
  );

  const latchApplyingRun = useCallback(
    (runId: string) => {
      if (activeScopeRef.current !== scopeKey) return;
      const generation = latchGenerationRef.current + 1;
      latchGenerationRef.current = generation;
      setLockLatch({ scopeKey, runId, generation });
    },
    [scopeKey]
  );

  const effectiveLockLatch =
    lockLatch &&
    lockLatch.scopeKey === scopeKey &&
    (!query.isSuccess || !query.data || query.data.latchGeneration < lockLatch.generation)
      ? lockLatch
      : null;

  useEffect(() => {
    if (canonicalRun) observeTerminalRun(canonicalRun);
  }, [canonicalRun, observeTerminalRun]);

  const projectionTarget = newerProjectionTarget(
    latchedProjectionTarget?.scopeKey === scopeKey ? latchedProjectionTarget.run : null,
    canonicalRun?.status === "succeeded" ? canonicalRun : null
  );

  const scopedActionError = actionError?.scopeKey === scopeKey ? actionError.value : null;
  const actionErrorHead = scopedActionError?.action === "undo" ? undoableRun : canonicalRun;
  const actionErrorAuthority =
    scopedActionError?.action === "undo" ? undoableAuthorityState : authorityState;
  const effectiveActionError =
    scopedActionError &&
    (actionErrorAuthority !== "ready" ||
      (actionErrorHead?.id === scopedActionError.runId &&
        actionErrorHead.status === scopedActionError.status &&
        actionErrorHead.updatedAt === scopedActionError.canonicalUpdatedAt))
      ? scopedActionError
      : null;

  useEffect(() => {
    if (!workspaceId) return;
    const subscription = getAssetsRealtimeKernel({
      workspaceId,
      storyProjectId: projectId,
    }).subscribe({
      onConnected: () => {
        setRealtimeConnected(true);
        requireFreshAuthorityRead();
        void refresh().catch(() => {
          // The canonical query exposes reconnect failures.
        });
      },
      onDisconnected: () => {
        // Realtime is the immediate lock-notification path. The instant it is
        // unavailable, invalidate the previous authority snapshot and establish
        // a fresh canonical snapshot through the polling fallback. Polling
        // remains active until the socket reconnects.
        setRealtimeConnected(false);
        requireFreshAuthorityRead();
        void refresh().catch(() => {
          // `authorityState` stays fail-closed and exposes the polling failure.
        });
      },
      onEvent: (event) => {
        if (event.kind !== "story_agent_run_changed") return;
        if (event.projectId !== projectId || event.workspaceId !== workspaceId) return;
        const parsedRun = StoryAgentRunDtoSchema.safeParse(event.run);
        if (
          !parsedRun.success ||
          parsedRun.data.projectId !== projectId ||
          parsedRun.data.workspaceId !== workspaceId
        ) {
          return;
        }
        const run = parsedRun.data;
        const belongsToSelectedChapter = chapterId === null || run.chapterId === chapterId;
        if (run.status === "applying") latchApplyingRun(run.id);
        if (belongsToSelectedChapter) {
          observeTerminalRun(run);
        } else if (isTerminalStoryAgentRun(run)) {
          // Draft revision and shared Story World data are project-wide even
          // though this run's proposal card belongs to another chapter.
          refreshProjectState();
        }
        void refresh().catch(() => {
          // The canonical query owns and exposes this failure through
          // `authorityState`; realtime delivery must never reject globally.
        });
      },
    });
    return () => subscription.close();
  }, [
    latchApplyingRun,
    observeTerminalRun,
    chapterId,
    projectId,
    refresh,
    refreshProjectState,
    requireFreshAuthorityRead,
    workspaceId,
  ]);

  const nextMutationVariables = useCallback(
    (
      runId: string,
      action: Exclude<StoryAgentRunAction, "undo">
    ): StoryAgentRunMutationVariables => {
      if (activeScopeRef.current !== scopeKey) {
        throw new StoryAgentRunActionGuardError("projectScopeChanged", action);
      }
      const currentAuthority = authorityStateRef.current;
      const currentRun = canonicalRunRef.current;
      if (currentAuthority !== "ready" || !currentRun || currentRun.id !== runId) {
        throw new StoryAgentRunActionGuardError("canonicalHeadChanged", action);
      }
      if (action === "confirm" && currentRun.status !== "proposed") {
        throw new StoryAgentRunActionGuardError("runNotProposed", currentRun.status);
      }
      if (action === "cancel" && !CANCELLABLE_RUN_STATUSES.has(currentRun.status)) {
        throw new StoryAgentRunActionGuardError("runNotProposed", currentRun.status);
      }
      if (action === "retryAuthoring" && !RETRYABLE_AUTHORING_STATUSES.has(currentRun.status)) {
        throw new StoryAgentRunActionGuardError("runNotRetryable", currentRun.status);
      }
      const attempt = actionAttemptRef.current + 1;
      actionAttemptRef.current = attempt;
      latestActionAttemptRef.current = attempt;
      setActionError((current) => (current?.scopeKey === scopeKey ? null : current));
      return {
        scopeKey,
        workspaceId: workspaceId as string,
        projectId,
        runId,
        status: currentRun.status,
        canonicalUpdatedAt: currentRun.updatedAt,
        attempt,
      };
    },
    [projectId, scopeKey, workspaceId]
  );

  const nextUndoMutationVariables = useCallback(
    (
      runId: string,
      activeHead: StoryAgentRunDto | null,
      undoableHead: StoryAgentRunDto | null
    ): StoryAgentRunMutationVariables => {
      if (activeScopeRef.current !== scopeKey) {
        throw new StoryAgentRunActionGuardError("projectScopeChanged", "undo");
      }
      if (activeHead?.status === "proposed" || activeHead?.status === "applying") {
        throw new StoryAgentRunActionGuardError("undoBlockedByActiveRun", activeHead.status);
      }
      if (
        !undoableHead ||
        undoableHead.id !== runId ||
        undoableHead.status !== "succeeded" ||
        undoableHead.kind !== "apply"
      ) {
        throw new StoryAgentRunActionGuardError("undoHeadChanged");
      }
      const attempt = actionAttemptRef.current + 1;
      actionAttemptRef.current = attempt;
      latestActionAttemptRef.current = attempt;
      setActionError((current) => (current?.scopeKey === scopeKey ? null : current));
      return {
        scopeKey,
        workspaceId: workspaceId as string,
        projectId,
        runId,
        status: undoableHead.status,
        canonicalUpdatedAt: undoableHead.updatedAt,
        attempt,
      };
    },
    [projectId, scopeKey, workspaceId]
  );

  const recordMutationError = useCallback(
    (action: StoryAgentRunAction, error: unknown, variables: StoryAgentRunMutationVariables) => {
      if (latestActionAttemptRef.current !== variables.attempt) return;
      if (activeScopeRef.current !== scopeKey) return;
      setActionError({
        scopeKey,
        value: {
          runId: variables.runId,
          action,
          attempt: variables.attempt,
          status: variables.status,
          canonicalUpdatedAt: variables.canonicalUpdatedAt,
          error,
        },
      });
    },
    [scopeKey]
  );

  const handleMutationSuccess = useCallback(
    async (run: StoryAgentRunDto, holdWriteLatch: boolean, actionScopeKey: string) => {
      if (activeScopeRef.current !== actionScopeKey || actionScopeKey !== scopeKey) return;
      if (holdWriteLatch) latchApplyingRun(run.id);
      await refresh().catch(() => {
        // The action was accepted by the server. A failed canonical refresh is
        // represented by `authorityState`, not misreported as an action failure.
      });
    },
    [latchApplyingRun, refresh, scopeKey]
  );

  const confirmMutation = useMutation({
    mutationFn: ({
      workspaceId: actionWorkspaceId,
      projectId: actionProjectId,
      runId,
    }: StoryAgentRunMutationVariables) =>
      confirmStoryAgentRun(
        actionWorkspaceId,
        actionProjectId,
        runId,
        `story-agent-confirm:${runId}`
      ),
    onSuccess: (run, variables) => handleMutationSuccess(run, true, variables.scopeKey),
    onError: (error, variables) => recordMutationError("confirm", error, variables),
  });
  const cancelMutation = useMutation({
    mutationFn: ({
      workspaceId: actionWorkspaceId,
      projectId: actionProjectId,
      runId,
    }: StoryAgentRunMutationVariables) =>
      cancelStoryAgentRun(actionWorkspaceId, actionProjectId, runId),
    onSuccess: (run, variables) => handleMutationSuccess(run, false, variables.scopeKey),
    onError: (error, variables) => recordMutationError("cancel", error, variables),
  });
  const undoMutation = useMutation({
    mutationFn: ({
      workspaceId: actionWorkspaceId,
      projectId: actionProjectId,
      runId,
    }: StoryAgentRunMutationVariables) =>
      undoStoryAgentRun(actionWorkspaceId, actionProjectId, runId, `story-agent-undo:${runId}`),
    onSuccess: (run, variables) => handleMutationSuccess(run, true, variables.scopeKey),
    onError: (error, variables) => recordMutationError("undo", error, variables),
  });
  const retryAuthoringMutation = useMutation({
    mutationFn: ({
      workspaceId: actionWorkspaceId,
      projectId: actionProjectId,
      runId,
    }: StoryAgentRunMutationVariables) =>
      retryStoryAgentRunAuthoring(actionWorkspaceId, actionProjectId, runId),
    // Re-armed drafting still holds no write fence, so no applying latch.
    onSuccess: (run, variables) => handleMutationSuccess(run, false, variables.scopeKey),
    onError: (error, variables) => recordMutationError("retryAuthoring", error, variables),
  });

  const pendingAction: StoryAgentRunAction | null =
    confirmMutation.isPending && confirmMutation.variables?.scopeKey === scopeKey
      ? "confirm"
      : cancelMutation.isPending && cancelMutation.variables?.scopeKey === scopeKey
        ? "cancel"
        : undoMutation.isPending && undoMutation.variables?.scopeKey === scopeKey
          ? "undo"
          : retryAuthoringMutation.isPending &&
              retryAuthoringMutation.variables?.scopeKey === scopeKey
            ? "retryAuthoring"
            : null;

  const acknowledgeProjectionTarget = useCallback(
    (runId: string) => {
      if (activeScopeRef.current !== scopeKey) return;
      setLatchedProjectionTarget((current) =>
        current?.scopeKey === scopeKey && current.run.id === runId ? null : current
      );
    },
    [scopeKey]
  );

  return {
    run: canonicalRun,
    undoableRun,
    projectionTarget,
    authorityState,
    undoableAuthorityState,
    authoritySnapshotKey,
    hasAuthoritySnapshot: query.isFetchedAfterMount && query.data !== undefined,
    hasUndoableAuthoritySnapshot:
      undoableQuery.isFetchedAfterMount && undoableQuery.data !== undefined,
    authorityError: query.error ?? null,
    undoableAuthorityError: undoableQuery.error ?? null,
    refreshing: query.isFetching || undoableQuery.isFetching,
    refresh,
    applying: canonicalRun?.status === "applying" || effectiveLockLatch !== null,
    applyingRunId:
      canonicalRun?.status === "applying" ? canonicalRun.id : (effectiveLockLatch?.runId ?? null),
    actionPending: pendingAction !== null,
    pendingAction,
    actionError: effectiveActionError,
    async confirm(runId: string) {
      const variables = nextMutationVariables(runId, "confirm");
      return confirmMutation.mutateAsync(variables);
    },
    async cancel(runId: string) {
      const variables = nextMutationVariables(runId, "cancel");
      return cancelMutation.mutateAsync(variables);
    },
    async retryAuthoring(runId: string) {
      const variables = nextMutationVariables(runId, "retryAuthoring");
      return retryAuthoringMutation.mutateAsync(variables);
    },
    async undo(runId: string) {
      const heads = await refreshHeads();
      if (!heads) throw new StoryAgentRunActionGuardError("authorityUnavailable");
      const variables = nextUndoMutationVariables(runId, heads.active, heads.undoable);
      return undoMutation.mutateAsync(variables);
    },
    clearActionError() {
      setActionError((current) => (current?.scopeKey === scopeKey ? null : current));
      confirmMutation.reset();
      cancelMutation.reset();
      undoMutation.reset();
      retryAuthoringMutation.reset();
    },
    acknowledgeProjectionTarget,
  } as const;
}

export type StoryAgentRunController = ReturnType<typeof useStoryAgentRun>;

function isTerminalStoryAgentRun(run: StoryAgentRunDto): boolean {
  return run.status === "succeeded" || run.status === "failed" || run.status === "stale";
}

/**
 * Identifies the authoritative snapshot the projection queries were validated
 * against. Only write-relevant transitions may rotate it: a new run head
 * (id/status — every Agent projection commit changes one of these) or a new
 * authority generation (realtime-gap recovery). Metadata-only `updatedAt`
 * bumps and query error timestamps must NOT rotate the key: every rotation
 * resets `isFetchedAfterMount` on the projection queries, which re-latches
 * writes and forces a fresh read, so gratuitous rotation churns the canvas for
 * no safety gain. An error → recovery cycle on an unchanged head is already
 * fail-closed without rotation: the key passes through `null` while authority
 * is lost, and returning to this key re-arms `isFetchedAfterMount`.
 */
function storyAgentAuthoritySnapshotKey(
  run: StoryAgentRunDto | null,
  authorityGeneration: number
): string {
  const headKey = run ? `${run.id}:${run.status}` : "empty";
  return `${headKey}:authority-${authorityGeneration}`;
}

function newerProjectionTarget(
  current: StoryAgentProjectionTarget | null,
  candidate: StoryAgentProjectionTarget | null
): StoryAgentProjectionTarget | null {
  if (
    !candidate ||
    candidate.status !== "succeeded" ||
    candidate.resultDraftRevision === null ||
    candidate.resultLayoutRevision === null
  ) {
    return current;
  }
  if (
    current?.status === "succeeded" &&
    current.resultDraftRevision !== null &&
    current.resultLayoutRevision !== null &&
    (current.resultDraftRevision > candidate.resultDraftRevision ||
      current.resultLayoutRevision > candidate.resultLayoutRevision)
  ) {
    return current;
  }
  if (
    current?.id === candidate.id &&
    current.updatedAt === candidate.updatedAt &&
    current.status === candidate.status
  ) {
    return current;
  }
  return candidate;
}
