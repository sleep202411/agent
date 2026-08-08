/**
 * The canvas's reconciliation contract with out-of-band writes.
 *
 * A newer query result is not permission to overwrite unsaved creator work.
 * This module owns the authority decision independently of what invalidated
 * the canonical projection.
 */

export interface StoryDraftAdoptionInput {
  /** False on a cold start, before any canonical draft has been taken. */
  hydrated: boolean;
  chapterChanged: boolean;
  authoritativeRevision: number;
  currentRevision: number;
  hasConflict: boolean;
  /**
   * Lazy on purpose: proving local divergence means signing the whole in-memory
   * draft, and that only matters once the canonical revision has actually
   * advanced past the one already held.
   */
  hasLocalChanges: () => boolean;
}

/**
 * Whether a freshly-read canonical draft may replace the canvas's in-memory
 * copy.
 *
 * Reconciliation refetches; this decides adoption, and it is what keeps a
 * refetch from destroying work in progress. A creator holding unsaved local
 * edits keeps them — the newer canonical revision is left un-adopted, and the
 * divergence surfaces on the next save as a draft revision conflict, which has
 * its own recovery surface.
 *
 * A cold hydration and a chapter switch always adopt: neither has local work to
 * protect, and revisions are chapter-local, so comparing them across a switch
 * is meaningless (two chapters may both legitimately sit at revision zero).
 *
 * Mirrors `shouldAdoptAuthoritativeCanvasLayout` for the draft plane.
 */
export function shouldAdoptAuthoritativeStoryDraft(input: StoryDraftAdoptionInput): boolean {
  if (!input.hydrated || input.chapterChanged) return true;
  if (input.authoritativeRevision <= input.currentRevision || input.hasConflict) return false;
  return !input.hasLocalChanges();
}
