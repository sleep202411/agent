import { keepPreviousData } from "@tanstack/react-query";
import type { StoryAgentRunStatus } from "@repo/shared/story-agent";

/**
 * Capability checks that are true before transient canvas state is applied.
 * Pan, zoom, and selection are intentionally absent because they remain
 * available in every policy state.
 */
export interface StoryCanvasBasePermissions {
  canEditContent: boolean;
  canEditLayout: boolean;
  canManageProduction: boolean;
  canPreview: boolean;
  canPublish: boolean;
}

export interface StoryCanvasEditPolicyInput {
  basePermissions: StoryCanvasBasePermissions;
  hasDraftConflict: boolean;
  hasLayoutConflict: boolean;
  agentPhase: StoryAgentAuthoringPhase;
}

export type StoryAgentAuthoringPhase =
  | "checking"
  | "ready"
  | "takeover-pending"
  | "applying"
  | "reconciling"
  | "unavailable";

export type StoryProjectionAuthorityState = "checking" | "ready" | "unavailable";

export interface StoryProjectionAuthorityInput {
  hasWorkspace: boolean;
  agentAuthorityState: "checking" | "ready" | "error";
  workbenchFetchedAfterMount: boolean;
  workbenchError: boolean;
  layoutFetchedAfterMount: boolean;
  layoutError: boolean;
}

export function shouldFetchStoryProjection(
  hasWorkspace: boolean,
  agentAuthorityState: "checking" | "ready" | "error"
): boolean {
  return hasWorkspace && agentAuthorityState === "ready";
}

export function storyProjectionQueryKey(
  kind: "workbench" | "canvas-layout",
  workspaceId: string | null,
  projectId: string,
  authoritySnapshotKey: string | null
) {
  return [
    "story-studio",
    kind,
    workspaceId,
    projectId,
    "authority",
    authoritySnapshotKey ?? "unavailable",
  ] as const;
}

/**
 * Shared configuration for the two canonical projection queries (workbench and
 * canvas layout).
 *
 * `placeholderData: keepPreviousData` is load-bearing: the query key embeds the
 * authority snapshot, so every run-head transition or realtime-gap recovery
 * mints a new key. The previous projection snapshot must KEEP RENDERING while
 * the fresh read is in flight — unmounting the canvas for a refetch resets the
 * XYFlow viewport, kills the assistant layer (aborting any in-flight chat
 * stream), and drops composer drafts. Write safety is not carried by blanking
 * the screen: the rotated key resets `isFetchedAfterMount`, which keeps
 * `resolveStoryProjectionAuthority` in "checking" and therefore keeps every
 * mutation latched until the fresh read lands.
 */
export function storyProjectionQueryOptions<TData>(input: {
  kind: "workbench" | "canvas-layout";
  workspaceId: string | null;
  projectId: string;
  authoritySnapshotKey: string | null;
  agentAuthorityState: "checking" | "ready" | "error";
  queryFn: () => Promise<TData>;
}) {
  return {
    queryKey: storyProjectionQueryKey(
      input.kind,
      input.workspaceId,
      input.projectId,
      input.authoritySnapshotKey
    ),
    queryFn: input.queryFn,
    enabled: shouldFetchStoryProjection(Boolean(input.workspaceId), input.agentAuthorityState),
    retry: false,
    placeholderData: keepPreviousData,
  } as const;
}

/**
 * The active-run head is the serialization point for Agent commits. Project
 * projections must be fetched only after that head is current, and neither an
 * old TanStack cache entry nor a failed fresh read may authorize editing.
 */
export function resolveStoryProjectionAuthority({
  hasWorkspace,
  agentAuthorityState,
  workbenchFetchedAfterMount,
  workbenchError,
  layoutFetchedAfterMount,
  layoutError,
}: StoryProjectionAuthorityInput): StoryProjectionAuthorityState {
  if (!hasWorkspace || agentAuthorityState === "error") return "unavailable";
  if (agentAuthorityState !== "ready") return "checking";
  if (!workbenchFetchedAfterMount || !layoutFetchedAfterMount) return "checking";
  if (workbenchError || layoutError) return "unavailable";
  return "ready";
}

/**
 * Folds the combined projection authority into the fail-closed authority input
 * of `resolveStoryAgentAuthoringPhase`. This is the write gate that replaced
 * the old render gate: while a rotated authority key is refetching
 * ("checking"), the canvas keeps rendering its previous snapshot but every
 * mutation stays latched; a failed fresh read ("unavailable") latches writes
 * the same way an active-run authority error always has.
 */
export function resolveStoryCanvasWriteAuthority(
  projectionAuthority: StoryProjectionAuthorityState
): "checking" | "ready" | "error" {
  if (projectionAuthority === "ready") return "ready";
  return projectionAuthority === "checking" ? "checking" : "error";
}

export type StoryCanvasProjectionSurface = "loading" | "error" | "canvas";

/**
 * Rendering is deliberately decoupled from write authority. The full-screen
 * loading/error surfaces are reserved for a true cold start with nothing to
 * show; once any projection snapshot exists (including the kept-previous
 * snapshot under a rotated authority key) the canvas subtree must stay mounted
 * so the viewport, assistant chat stream, and composer drafts survive refetch
 * cycles. Stale data may render — it may never be written over, which
 * `resolveStoryCanvasWriteAuthority` enforces separately.
 */
export function resolveStoryCanvasProjectionSurface(
  projectionAuthority: StoryProjectionAuthorityState,
  hasProjectionData: boolean
): StoryCanvasProjectionSurface {
  if (hasProjectionData) return "canvas";
  if (projectionAuthority === "unavailable") return "error";
  return projectionAuthority === "ready" ? "canvas" : "loading";
}

export interface StoryAgentAuthoringPhaseInput {
  authorityState: "checking" | "ready" | "error";
  takeoverPending: boolean;
  applying: boolean;
  runStatus: StoryAgentRunStatus | null;
  resultDraftRevision: number | null;
  resultLayoutRevision: number | null;
  draftRevision: number;
  layoutRevision: number | null;
  hasConflict: boolean;
}

/**
 * Converts transport, lock and projection state into one fail-closed phase.
 * A terminal Agent run is not editable until both canonical projections have
 * reached the revisions committed by that run.
 */
export function resolveStoryAgentAuthoringPhase({
  authorityState,
  takeoverPending,
  applying,
  runStatus,
  resultDraftRevision,
  resultLayoutRevision,
  draftRevision,
  layoutRevision,
  hasConflict,
}: StoryAgentAuthoringPhaseInput): StoryAgentAuthoringPhase {
  if (takeoverPending) return "takeover-pending";
  if (applying) return "applying";
  if (authorityState === "checking") return "checking";
  if (authorityState === "error") return "unavailable";

  const resultReconciled =
    runStatus !== "succeeded" ||
    (resultDraftRevision !== null &&
      resultLayoutRevision !== null &&
      draftRevision >= resultDraftRevision &&
      layoutRevision !== null &&
      layoutRevision >= resultLayoutRevision);
  if (!resultReconciled && !hasConflict) return "reconciling";
  return "ready";
}

export type StoryCanvasReadOnlyReason =
  | "agent-checking"
  | "agent-takeover-pending"
  | "agent-applying"
  | "agent-reconciling"
  | "agent-unavailable"
  | "draft-conflict"
  | "layout-conflict"
  | "permission"
  | null;

export interface StoryCanvasEditPolicy {
  canEditContent: boolean;
  canEditLayout: boolean;
  canManageProduction: boolean;
  canPreview: boolean;
  canPublish: boolean;
  readOnlyReason: StoryCanvasReadOnlyReason;
}

/**
 * Mutable, commit-time authority used by canvas event handlers.
 *
 * XYFlow may finish a drag/delete/connect callback after a realtime Agent lock
 * has already committed a new React render. Event-handler closures are
 * therefore presentation state, not write authority. Every final human
 * mutation reads this ref-backed snapshot immediately before touching local
 * draft/layout state.
 */
export interface StoryCanvasMutationBarrierState {
  canEditContent: boolean;
  canEditLayout: boolean;
  canManageProduction: boolean;
  takeoverPending: boolean;
}

export type StoryCanvasMutationScope = "content" | "layout" | "production";

export interface StoryCanvasMutationBarrier {
  update: (state: StoryCanvasMutationBarrierState) => void;
  setTakeoverPending: (pending: boolean) => void;
  permits: (scope: StoryCanvasMutationScope) => boolean;
}

export function permitsStoryCanvasMutation(
  state: StoryCanvasMutationBarrierState,
  scope: StoryCanvasMutationScope
): boolean {
  if (state.takeoverPending) return false;
  if (scope === "content") return state.canEditContent;
  if (scope === "layout") return state.canEditLayout;
  return state.canManageProduction;
}

/** Stable event-handler authority whose internals are updated after each commit. */
export function createStoryCanvasMutationBarrier(
  initial: StoryCanvasMutationBarrierState = {
    canEditContent: false,
    canEditLayout: false,
    canManageProduction: false,
    takeoverPending: false,
  }
): StoryCanvasMutationBarrier {
  let current = { ...initial };
  return {
    update(state) {
      current = { ...state };
    },
    setTakeoverPending(pending) {
      current = { ...current, takeoverPending: pending };
    },
    permits(scope) {
      return permitsStoryCanvasMutation(current, scope);
    },
  };
}

/**
 * Resolves every authoring gate from one state snapshot.
 *
 * A proposal is deliberately non-locking: the confirmation path is
 * responsible for flushing local writes and performing its revision CAS.
 * The client remains fail-closed while the authoritative lock head is loading,
 * a takeover request is flushing, the Agent is applying, or the resulting
 * draft/layout revisions are reconciling. Preview is read-only and remains
 * available throughout.
 */
export function resolveStoryCanvasEditPolicy({
  basePermissions,
  hasDraftConflict,
  hasLayoutConflict,
  agentPhase,
}: StoryCanvasEditPolicyInput): StoryCanvasEditPolicy {
  const agentBlocksWrites = agentPhase !== "ready";

  const canEditContent = basePermissions.canEditContent && !hasDraftConflict && !agentBlocksWrites;
  const canEditLayout =
    basePermissions.canEditLayout && !hasDraftConflict && !hasLayoutConflict && !agentBlocksWrites;
  const canManageProduction =
    basePermissions.canManageProduction && !hasDraftConflict && !agentBlocksWrites;
  const canPreview = basePermissions.canPreview;
  const canPublish = basePermissions.canPublish && !hasDraftConflict && !agentBlocksWrites;

  let readOnlyReason: StoryCanvasReadOnlyReason = null;
  if (agentPhase !== "ready") {
    readOnlyReason = `agent-${agentPhase}`;
  } else if (hasDraftConflict) {
    readOnlyReason = "draft-conflict";
  } else if (!basePermissions.canEditContent) {
    readOnlyReason = "permission";
  } else if (hasLayoutConflict) {
    readOnlyReason = "layout-conflict";
  }

  return {
    canEditContent,
    canEditLayout,
    canManageProduction,
    canPreview,
    canPublish,
    readOnlyReason,
  };
}
