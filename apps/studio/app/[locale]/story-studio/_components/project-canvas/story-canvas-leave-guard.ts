export type StoryCanvasRecoveryPlane = "draft" | "layout" | "generation";

export interface StoryCanvasLeaveRiskInput {
  draftDirty: boolean;
  draftSaveInFlight: boolean;
  draftConflict: boolean;
  layoutDirty: boolean;
  layoutSaveInFlight: boolean;
  layoutConflict: boolean;
  generationRecipeDirty: boolean;
}

export interface StoryCanvasLeaveRisk {
  blocked: boolean;
  planes: readonly StoryCanvasRecoveryPlane[];
}

export interface StoryCanvasNavigationEvent {
  preventDefault: () => void;
}

export interface StoryCanvasHistoryEntry {
  href: string;
  state: unknown;
}

export interface StoryCanvasHistoryTraversalEvent {
  state: unknown;
  stopImmediatePropagation: () => void;
}

export interface StoryCanvasHistoryController {
  pushState: (data: unknown, unused: string, url?: string | URL | null) => void;
  back: () => void;
}

/**
 * One product-level definition of work that cannot be discarded implicitly.
 * Refs, retries and transport state stay in the canvas; every navigation and
 * unload surface consumes this stable decision instead of inventing its own
 * partial list.
 */
export function resolveStoryCanvasLeaveRisk({
  draftDirty,
  draftSaveInFlight,
  draftConflict,
  layoutDirty,
  layoutSaveInFlight,
  layoutConflict,
  generationRecipeDirty,
}: StoryCanvasLeaveRiskInput): StoryCanvasLeaveRisk {
  const planes: StoryCanvasRecoveryPlane[] = [];
  if (draftDirty || draftSaveInFlight || draftConflict) planes.push("draft");
  if (layoutDirty || layoutSaveInFlight || layoutConflict) planes.push("layout");
  if (generationRecipeDirty) planes.push("generation");
  return { blocked: planes.length > 0, planes };
}

/** Blocks a sanctioned Next.js client navigation and opens the product dialog. */
export function guardStoryCanvasNavigation(
  event: StoryCanvasNavigationEvent,
  risk: StoryCanvasLeaveRisk,
  onBlocked: (risk: StoryCanvasLeaveRisk) => void
): boolean {
  if (!risk.blocked) return false;
  event.preventDefault();
  onBlocked(risk);
  return true;
}

/** Coordinates both declarative Link events and programmatic router actions. */
export function coordinateStoryCanvasNavigation({
  event,
  risk,
  resume,
  onBlocked,
}: {
  event: StoryCanvasNavigationEvent | null;
  risk: StoryCanvasLeaveRisk;
  resume: () => void;
  onBlocked: (risk: StoryCanvasLeaveRisk, resume: () => void) => void;
}): boolean {
  if (!risk.blocked) {
    if (!event) resume();
    return false;
  }
  event?.preventDefault();
  onBlocked(risk, resume);
  return true;
}

/**
 * Cancels a same-document browser traversal before Next's App Router consumes
 * its popstate event. History traversal events are not cancellable, so the
 * current entry is restored synchronously. That makes the attempted back or
 * forward destination the immediately preceding entry; an explicit discard
 * can then resume the exact traversal with one `history.back()` call.
 */
export function guardStoryCanvasHistoryTraversal({
  event,
  risk,
  currentEntry,
  history,
  onBlocked,
}: {
  event: StoryCanvasHistoryTraversalEvent;
  risk: StoryCanvasLeaveRisk;
  currentEntry: StoryCanvasHistoryEntry;
  history: StoryCanvasHistoryController;
  onBlocked: (risk: StoryCanvasLeaveRisk, resume: () => void) => void;
}): boolean {
  if (!risk.blocked) return false;

  event.stopImmediatePropagation();
  history.pushState(currentEntry.state, "", currentEntry.href);
  onBlocked(risk, () => history.back());
  return true;
}
