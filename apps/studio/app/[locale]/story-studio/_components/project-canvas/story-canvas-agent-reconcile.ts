/**
 * The canvas's reconciliation contract with out-of-band writes.
 *
 * The Studio Agent writes the story draft server-side. The canvas reads that
 * draft through react-query and holds it in memory, so it only learns about an
 * agent write when something invalidates the projection. This module owns the
 * second half of that handshake: WHETHER the fresh read may replace what the
 * creator is holding.
 *
 * The first half — WHEN to re-read — is no longer a predicate over a stream of
 * events, because there is no event stream. It is a token, computed in
 * `useStoryStudioAgentSession` from two facts the delivery layer and the
 * control plane each state plainly:
 *
 *   - `history.writeToken` — every capability action that has reached a
 *     terminal status. An applied write is in the database, or provably is not.
 *   - `panel.turnTerminalToken` — the turn itself ending. The safety net, and
 *     the reason the trigger is not just the write: a capability that commits
 *     its write and then throws while summarising it reports the ACTION as
 *     failed, which used to leave the canvas rendering the pre-edit draft until
 *     a manual page reload.
 *
 * Either changing sends the canvas back to the server. That is a reconcile
 * trigger, never an adoption decision — see below.
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
 * its own recovery surface. Silently overwriting a creator's local draft in
 * order to display an agent edit would be a worse bug than briefly showing a
 * stale one.
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
