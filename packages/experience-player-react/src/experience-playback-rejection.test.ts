import { describe, expect, it } from "vitest";
import { resolveExperiencePlaybackRejection } from "./experience-playback-rejection";

/**
 * These two guards are the difference between a film that plays through its
 * clip transitions and one that throws a runtime-error dialog at every cut, so
 * each case is driven by the DOM exception a real browser raises — discriminated
 * by `name`, never by the message prose.
 */
function domException(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** Stands in for `ExperienceMediaPlaybackHandle`: only identity is ever read. */
function handle(label: string) {
  return { label };
}

const DECODE_FAILURE = domException("NotSupportedError", "The element has no supported sources.");
const INTERRUPTED = domException(
  "AbortError",
  "The play() request was interrupted by a new load request."
);

describe("resolveExperiencePlaybackRejection", () => {
  it("surfaces a genuine failure from the handle that is still registered", () => {
    const live = handle("live");
    expect(resolveExperiencePlaybackRejection(live, live, DECODE_FAILURE)).toBe("surface");
  });

  it("ignores a rejection from a handle that has already been replaced", () => {
    // The next clip mounted and registered its own handle before the previous
    // clip's play() rejected. Acting on it would pause the clip now on stage
    // and name media the viewer is no longer watching.
    const previous = handle("previous");
    const current = handle("current");
    expect(resolveExperiencePlaybackRejection(current, previous, DECODE_FAILURE)).toBe(
      "stale-handle"
    );
  });

  it("ignores a rejection from a handle that has been unregistered", () => {
    // Teardown path: the renderer unmounted, so the slot holds nothing. Same
    // conclusion — nobody is left for this rejection to speak for.
    const gone = handle("gone");
    expect(resolveExperiencePlaybackRejection(undefined, gone, DECODE_FAILURE)).toBe(
      "stale-handle"
    );
    expect(resolveExperiencePlaybackRejection(null, gone, DECODE_FAILURE)).toBe("stale-handle");
  });

  it("ignores a routine interruption on the live handle", () => {
    // A `src` swap between two clips of one sequence aborts the pending play().
    // That is the transition working, not a failure.
    const live = handle("live");
    expect(resolveExperiencePlaybackRejection(live, live, INTERRUPTED)).toBe(
      "routine-interruption"
    );
  });

  it("reports staleness before classifying, so a stale handle is silent whatever it says", () => {
    const previous = handle("previous");
    const current = handle("current");
    expect(resolveExperiencePlaybackRejection(current, previous, INTERRUPTED)).toBe("stale-handle");
  });

  it.each([
    ["a plain Error whose prose says AbortError", new Error("AbortError")],
    ["a bare string", "AbortError"],
    ["null", null],
    ["undefined", undefined],
  ])("surfaces %s rather than guessing it was routine", (_label, error) => {
    // Messages are localized browser copy, so only `name` decides. Anything
    // unclassifiable is a real failure until proven otherwise.
    const live = handle("live");
    expect(resolveExperiencePlaybackRejection(live, live, error)).toBe("surface");
  });
});
