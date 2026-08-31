import { keepPreviousData } from "@tanstack/react-query";

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

export type StoryProjectionReadinessState = "loading" | "ready" | "unavailable";

export interface StoryCanvasEditPolicyInput {
  basePermissions: StoryCanvasBasePermissions;
  projectionReadiness: StoryProjectionReadinessState;
  hasDraftConflict: boolean;
  hasLayoutConflict: boolean;
}

export interface StoryProjectionReadinessInput {
  workbenchFetchedAfterMount: boolean;
  workbenchError: boolean;
  layoutFetchedAfterMount: boolean;
  layoutError: boolean;
}

export interface StoryChapterProjectionPairInput {
  targetChapterId: string | null;
  workbenchChapterId: string | null;
  layoutChapterId: string | null;
  workbenchPlaceholder: boolean;
  layoutPlaceholder: boolean;
}

/**
 * A chapter is render-authoritative only when both canonical planes are fresh
 * and name the same requested chapter. Keeping this check separate from query
 * availability prevents a retained workbench from being paired with a fresh
 * layout (or vice versa) while the URL chapter is changing.
 */
export function isStoryChapterProjectionPairReady({
  targetChapterId,
  workbenchChapterId,
  layoutChapterId,
  workbenchPlaceholder,
  layoutPlaceholder,
}: StoryChapterProjectionPairInput): boolean {
  return Boolean(
    targetChapterId &&
    !workbenchPlaceholder &&
    !layoutPlaceholder &&
    workbenchChapterId === targetChapterId &&
    layoutChapterId === targetChapterId
  );
}

export function storyProjectionQueryKey(
  kind: "workbench" | "canvas-layout",
  projectId: string,
  chapterId: string | null
) {
  return ["story-studio", kind, projectId, "chapter", chapterId ?? "default"] as const;
}

/**
 * Matches any canonical projection query (workbench or canvas-layout, any
 * chapter) for a project. Used to invalidate the canvas when an out-of-band
 * mutation may have bumped the draft revision, so it refetches instead of
 * showing a stale draft/layout — see `requiresStoryProjectionReconcile` for the
 * triggers. Project IDs are globally unique, so no ambient scope belongs in
 * this canonical key.
 */
export function matchesStoryProjectionQueryKey(
  queryKey: readonly unknown[],
  projectId: string
): boolean {
  return (
    queryKey[0] === "story-studio" &&
    (queryKey[1] === "workbench" || queryKey[1] === "canvas-layout") &&
    queryKey[2] === projectId
  );
}

/**
 * Shared configuration for the two canonical projection queries.
 *
 * `placeholderData: keepPreviousData` keeps the mounted canvas, viewport,
 * assistant stream, and local composer state stable while a chapter key
 * changes. The previous chapter may render during that transition, but
 * `isStoryChapterProjectionPairReady` keeps mutations closed until both
 * canonical planes name the requested chapter.
 */
export function storyProjectionQueryOptions<TData>(input: {
  kind: "workbench" | "canvas-layout";
  projectId: string;
  chapterId: string | null;
  queryFn: () => Promise<TData>;
}) {
  return {
    queryKey: storyProjectionQueryKey(input.kind, input.projectId, input.chapterId),
    queryFn: input.queryFn,
    enabled: input.kind === "workbench" || Boolean(input.chapterId),
    retry: false,
    placeholderData: keepPreviousData,
  } as const;
}

/**
 * Resolves whether the two server-owned projections can authorize a mutation.
 * This is independent of any assistant run: draft/layout revision CAS remains
 * the write authority, while the client merely requires one canonical read
 * from each observer before editing.
 */
export function resolveStoryProjectionReadiness({
  workbenchFetchedAfterMount,
  workbenchError,
  layoutFetchedAfterMount,
  layoutError,
}: StoryProjectionReadinessInput): StoryProjectionReadinessState {
  if (!workbenchFetchedAfterMount || !layoutFetchedAfterMount) return "loading";
  if (workbenchError || layoutError) return "unavailable";
  return "ready";
}

export type StoryCanvasProjectionSurface = "loading" | "error" | "canvas";

/**
 * Full-screen loading/error surfaces are reserved for a cold start. Once a
 * projection exists, it remains mounted through chapter transitions and failed
 * refreshes so the viewport and local UI state do not flash or reset.
 */
export function resolveStoryCanvasProjectionSurface(
  projectionReadiness: StoryProjectionReadinessState,
  hasProjectionData: boolean
): StoryCanvasProjectionSurface {
  if (hasProjectionData) return "canvas";
  if (projectionReadiness === "unavailable") return "error";
  return projectionReadiness === "ready" ? "canvas" : "loading";
}

export type StoryCanvasReadOnlyReason =
  | "projection-loading"
  | "projection-unavailable"
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
 * Mutable, commit-time policy used by canvas event handlers.
 *
 * XYFlow may finish a drag/delete/connect callback after a new React render.
 * Every final mutation therefore reads this ref-backed snapshot immediately
 * before touching local draft/layout state.
 */
export interface StoryCanvasMutationBarrierState {
  canEditContent: boolean;
  canEditLayout: boolean;
  canManageProduction: boolean;
}

export type StoryCanvasMutationScope = "content" | "layout" | "production";

export interface StoryCanvasMutationBarrier {
  update: (state: StoryCanvasMutationBarrierState) => void;
  permits: (scope: StoryCanvasMutationScope) => boolean;
}

export function permitsStoryCanvasMutation(
  state: StoryCanvasMutationBarrierState,
  scope: StoryCanvasMutationScope
): boolean {
  if (scope === "content") return state.canEditContent;
  if (scope === "layout") return state.canEditLayout;
  return state.canManageProduction;
}

/** Stable event-handler policy whose internals are updated after each commit. */
export function createStoryCanvasMutationBarrier(
  initial: StoryCanvasMutationBarrierState = {
    canEditContent: false,
    canEditLayout: false,
    canManageProduction: false,
  }
): StoryCanvasMutationBarrier {
  let current = { ...initial };
  return {
    update(state) {
      current = { ...state };
    },
    permits(scope) {
      return permitsStoryCanvasMutation(current, scope);
    },
  };
}

/**
 * Resolves every authoring gate from project capabilities, canonical
 * projection readiness, and revision conflicts. Assistants operate through
 * their own capability/approval/event pipeline and never become canvas write
 * authority.
 */
export function resolveStoryCanvasEditPolicy({
  basePermissions,
  projectionReadiness,
  hasDraftConflict,
  hasLayoutConflict,
}: StoryCanvasEditPolicyInput): StoryCanvasEditPolicy {
  const projectionReady = projectionReadiness === "ready";
  const canEditContent = basePermissions.canEditContent && projectionReady && !hasDraftConflict;
  const canEditLayout =
    basePermissions.canEditLayout && projectionReady && !hasDraftConflict && !hasLayoutConflict;
  const canManageProduction =
    basePermissions.canManageProduction && projectionReady && !hasDraftConflict;
  const canPreview = basePermissions.canPreview;
  const canPublish = basePermissions.canPublish && projectionReady && !hasDraftConflict;

  let readOnlyReason: StoryCanvasReadOnlyReason = null;
  if (projectionReadiness === "loading") {
    readOnlyReason = "projection-loading";
  } else if (projectionReadiness === "unavailable") {
    readOnlyReason = "projection-unavailable";
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
