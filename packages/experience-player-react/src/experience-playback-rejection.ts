import { isRoutinePlaybackInterruption } from "./experience-media-player";

/**
 * Why a rejected `play()` was, or was not, turned into a runtime-error dialog.
 *
 * The verdict is named rather than boolean so the two independent reasons to
 * stay silent cannot be confused for one another when this is read back — in a
 * test, in a log line, or by the next person to touch the host.
 */
export type ExperiencePlaybackRejectionVerdict =
  /** The handle that rejected is no longer the one registered for its slot. */
  | "stale-handle"
  /** The browser interrupted a pending `play()`; a clip transition looks like this. */
  | "routine-interruption"
  /** A real playback failure. The host stops the clip and tells the viewer. */
  | "surface";

/**
 * Decide what a rejected `play()` means for the host that registered the handle.
 *
 * Both silent verdicts exist because a media element outlives the handles that
 * point at it: successive clips of a sequence reuse ONE element, and each clip
 * hands the host a fresh handle. A rejection is therefore not necessarily about
 * the clip that is on stage right now.
 *
 * - `stale-handle` — the rejection belongs to a handle that has already been
 *   replaced or unregistered. Acting on it would pause the clip now playing and
 *   name media the viewer is no longer watching. Only the registered handle may
 *   speak for the element.
 * - `routine-interruption` — the same race seen from the browser's side. An
 *   `AbortError` is what a normal `src` swap raises; there is nothing to report.
 * - `surface` — everything else, including decode and source failures, which
 *   must still reach the viewer.
 *
 * The staleness check comes first: a stale handle's rejection is irrelevant
 * whatever it says, so its classification never needs to be trusted.
 *
 * Kept as a pure function, separate from the React host, because these are the
 * two guards that decide whether a perfectly healthy film gets interrupted by a
 * dialog — they have to be assertable without a media element or a DOM.
 */
export function resolveExperiencePlaybackRejection<THandle>(
  registeredHandle: THandle | null | undefined,
  rejectedHandle: THandle,
  error: unknown
): ExperiencePlaybackRejectionVerdict {
  if (registeredHandle !== rejectedHandle) return "stale-handle";
  if (isRoutinePlaybackInterruption(error)) return "routine-interruption";
  return "surface";
}
