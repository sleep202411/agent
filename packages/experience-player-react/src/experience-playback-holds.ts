/**
 * Why the viewer has the story paused: `user` and `hidden` are the viewer or the
 * system stopping it with the page visible or hidden; `refused` is the browser
 * declining to play without a tap (WebKit's per-element rule, Low Power Mode).
 */
export type ExperienceViewerPauseReason = "user" | "hidden" | "refused";

/** Everything that can hold playback back. */
export interface ExperiencePlaybackGates {
  started: boolean;
  ended: boolean;
  failed: boolean;
  viewerPause: ExperienceViewerPauseReason | null;
  /** An access check or purchase is in progress. */
  accessPending: boolean;
  /** A declined unlock waits for the viewer's Continue. */
  retryAccess: boolean;
  /** The locked-scene backdrop covers the frame. */
  nodeGate: boolean;
  /** A timeline-control charge holds its clip until it is pressed. */
  chargeGate: boolean;
}

export interface ExperiencePlaybackHolds {
  /** Started, and neither ended nor failed: the only time the story can pause. */
  running: boolean;
  /** Story time stands still: the story clock and every timer on it. */
  storyHeld: boolean;
  /** Web Audio is suspended. */
  audioHeld: boolean;
  /** Video stays paused. */
  mediaHeld: boolean;
  /** The pause controls may show, and the viewer may resume. */
  pauseUi: boolean;
}

/**
 * The one statement of what holds what. A viewer pause and an access flow hold
 * all of it; a charge gate holds only the clip, because its idle timeout is story
 * time and has to run out; an ending holds the clock and the clip but leaves
 * Web Audio alone, so cues at the ending can still sound; a failure holds all.
 *
 * Kept pure so the render and the code between renders decide with the same
 * rule from the same inputs (see the host's `holdsNow`), and so it can be
 * asserted without a player.
 */
export function resolveExperiencePlaybackHolds(
  gates: ExperiencePlaybackGates
): ExperiencePlaybackHolds {
  const accessHeld = gates.accessPending || gates.retryAccess;
  const running = gates.started && !gates.ended && !gates.failed;
  const storyHeld = !running || gates.viewerPause !== null || accessHeld;
  return {
    running,
    storyHeld,
    audioHeld: gates.viewerPause !== null || accessHeld || gates.failed,
    mediaHeld: storyHeld || gates.chargeGate,
    pauseUi: running && !gates.nodeGate && !accessHeld,
  };
}

export type ExperienceViewerPauseEvent =
  | { type: "pause"; reason: ExperienceViewerPauseReason }
  /** `gesture` is a tap or a key, which can unlock media; `system` is the OS media controls. */
  | { type: "resume"; source: "gesture" | "system" };

/**
 * The viewer pause after `event`: `current` when the event changes nothing.
 *
 * Only a running story pauses. A refusal replaces any other reason and nothing
 * replaces a refusal, because only a tap makes the element playable again — so
 * the OS controls cannot resume one either. A resume needs what the pause
 * controls need (`pauseUi`): no access flow or locked-scene gate in the way.
 */
export function nextExperienceViewerPause(
  current: ExperienceViewerPauseReason | null,
  event: ExperienceViewerPauseEvent,
  holds: Pick<ExperiencePlaybackHolds, "running" | "pauseUi">
): ExperienceViewerPauseReason | null {
  if (event.type === "pause") {
    if (!holds.running || current === "refused") return current;
    return current === null || event.reason === "refused" ? event.reason : current;
  }
  if (current === null || !holds.pauseUi) return current;
  if (current === "refused" && event.source === "system") return current;
  return null;
}
