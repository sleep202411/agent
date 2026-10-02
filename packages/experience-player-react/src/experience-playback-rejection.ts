import { isAutoplayPolicyRefusal, isRoutinePlaybackInterruption } from "./experience-media-player";

/**
 * What a rejected `play()` means for the film: nothing, a pause, or a failure.
 *
 * The verdict is named rather than boolean so the independent reasons to stay
 * silent cannot be confused for one another when this is read back — in a
 * test, in a log line, or by the next person to touch the host.
 */
export type ExperiencePlaybackRejectionVerdict =
  /** The handle that rejected is no longer the one registered for its slot. */
  | "stale-handle"
  /** The browser interrupted a pending `play()`; a clip transition looks like this. */
  | "routine-interruption"
  /** The browser will not play without a tap. The host pauses the story for one. */
  | "refused"
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
 * - `refused` — a `NotAllowedError`: the autoplay policy declined, and it
 *   reaches the host only after the muted retry (see playWithSoundFallback), so
 *   sound was not the reason. WebKit grants an element only to a `play()` made
 *   inside a user activation, and Low Power Mode refuses every other one. That
 *   is recoverable with one tap, so it pauses the story; it is not a failure.
 * - `surface` — everything else, including decode and source failures, which
 *   must still reach the viewer.
 *
 * The staleness check comes first: a stale handle's rejection is irrelevant
 * whatever it says, so its classification never needs to be trusted.
 *
 * Kept as a pure function, separate from the React host, because these are the
 * guards that decide whether a perfectly healthy film gets interrupted by a
 * dialog — they have to be assertable without a media element or a DOM.
 */
export function resolveExperiencePlaybackRejection<THandle>(
  registeredHandle: THandle | null | undefined,
  rejectedHandle: THandle,
  error: unknown
): ExperiencePlaybackRejectionVerdict {
  if (registeredHandle !== rejectedHandle) return "stale-handle";
  if (isRoutinePlaybackInterruption(error)) return "routine-interruption";
  if (isAutoplayPolicyRefusal(error)) return "refused";
  return "surface";
}
