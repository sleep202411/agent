import { describe, expect, it, vi } from "vitest";
import {
  isRoutinePlaybackInterruption,
  playWithSoundFallback,
  type ExperienceSoundFallbackTarget,
} from "./experience-media-player";

/**
 * A media element rejects `play()` for unrelated reasons and the fallback has to
 * tell them apart, so each case is driven by the DOM exception a real browser
 * raises — discriminated by `name`, never by the message prose.
 */
function domException(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** Records what the fallback did to the element, in order. */
function fallbackTarget(...outcomes: readonly (Error | null)[]) {
  const plays: unknown[] = [];
  const mutes: boolean[] = [];
  let attempt = 0;
  const target: ExperienceSoundFallbackTarget = {
    play: () => {
      const outcome = outcomes[attempt++] ?? null;
      plays.push(outcome);
      return outcome ? Promise.reject(outcome) : Promise.resolve();
    },
    setMuted: (muted) => void mutes.push(muted),
  };
  return { target, plays, mutes };
}

describe("playWithSoundFallback", () => {
  it("plays with sound and touches nothing when the browser allows it", async () => {
    const { target, plays, mutes } = fallbackTarget(null);
    const mutedRef = { current: false };
    const onSoundBlocked = vi.fn();

    await playWithSoundFallback(target, mutedRef, onSoundBlocked);

    expect(plays).toHaveLength(1);
    expect(mutes).toEqual([]);
    expect(mutedRef.current).toBe(false);
    expect(onSoundBlocked).not.toHaveBeenCalled();
  });

  it("mutes, retries once, and raises the unmute affordance on an autoplay-policy refusal", async () => {
    const refusal = domException(
      "NotAllowedError",
      "play() failed because the user didn't interact with the document first."
    );
    const { target, plays, mutes } = fallbackTarget(refusal, null);
    const mutedRef = { current: false };
    // This callback IS the unmute affordance: the host renders the button in
    // response to it and nothing else can reveal it.
    const onSoundBlocked = vi.fn();

    await expect(playWithSoundFallback(target, mutedRef, onSoundBlocked)).resolves.toBeUndefined();

    expect(plays).toHaveLength(2);
    expect(mutes).toEqual([true]);
    expect(mutedRef.current).toBe(true);
    expect(onSoundBlocked).toHaveBeenCalledTimes(1);
  });

  it("rethrows an AbortError without muting or retrying", async () => {
    // Routine during clip transitions: a pending play() interrupted by a src
    // swap or teardown. Nobody blocked sound, so nothing may be silenced.
    const aborted = domException(
      "AbortError",
      "The play() request was interrupted by a new load request."
    );
    const { target, plays, mutes } = fallbackTarget(aborted);
    const mutedRef = { current: false };
    const onSoundBlocked = vi.fn();

    await expect(playWithSoundFallback(target, mutedRef, onSoundBlocked)).rejects.toBe(aborted);

    expect(plays).toHaveLength(1);
    expect(mutes).toEqual([]);
    expect(mutedRef.current).toBe(false);
    expect(onSoundBlocked).not.toHaveBeenCalled();
  });

  it("rethrows a NotSupportedError without muting or retrying", async () => {
    // The source cannot be decoded. Muting fixes nothing and would swallow a
    // real media failure the host needs to surface.
    const unsupported = domException("NotSupportedError", "The element has no supported sources.");
    const { target, plays, mutes } = fallbackTarget(unsupported);
    const mutedRef = { current: false };
    const onSoundBlocked = vi.fn();

    await expect(playWithSoundFallback(target, mutedRef, onSoundBlocked)).rejects.toBe(unsupported);

    expect(plays).toHaveLength(1);
    expect(mutes).toEqual([]);
    expect(onSoundBlocked).not.toHaveBeenCalled();
  });

  it("propagates a refusal on an already-muted clip instead of looping", async () => {
    const refusal = domException("NotAllowedError", "play() failed.");
    const { target, plays, mutes } = fallbackTarget(refusal, refusal);
    const mutedRef = { current: true };
    const onSoundBlocked = vi.fn();

    await expect(playWithSoundFallback(target, mutedRef, onSoundBlocked)).rejects.toBe(refusal);

    // Muting cannot be the fix when the clip is already muted, so there is no
    // second attempt and no affordance offering sound that was never lost.
    expect(plays).toHaveLength(1);
    expect(mutes).toEqual([]);
    expect(onSoundBlocked).not.toHaveBeenCalled();
  });

  it("propagates a failure of the muted retry itself", async () => {
    const refusal = domException("NotAllowedError", "play() failed.");
    const retryFailure = domException("AbortError", "The play() request was interrupted.");
    const { target, plays } = fallbackTarget(refusal, retryFailure);
    const mutedRef = { current: false };
    const onSoundBlocked = vi.fn();

    await expect(playWithSoundFallback(target, mutedRef, onSoundBlocked)).rejects.toBe(
      retryFailure
    );

    expect(plays).toHaveLength(2);
    expect(onSoundBlocked).toHaveBeenCalledTimes(1);
  });
});

/**
 * This verdict decides whether the host raises its runtime-error dialog, so the
 * cost of getting it wrong is asymmetric: a false "routine" hides a real media
 * failure, a false "fatal" interrupts a film that is playing perfectly well
 * every time it changes clip.
 */
describe("isRoutinePlaybackInterruption", () => {
  it("classifies an AbortError as routine", () => {
    // What a clip transition raises: the pending play() was superseded by the
    // next source. Nothing is wrong and there is nothing to tell the viewer.
    expect(
      isRoutinePlaybackInterruption(
        domException("AbortError", "The play() request was interrupted by a new load request.")
      )
    ).toBe(true);
  });

  it("classifies an AbortError from another realm as routine", () => {
    // An iframe or worker rejection is not `instanceof DOMException` here, so
    // the verdict has to come off `name` for a cross-realm film to survive its
    // own clip transitions.
    expect(isRoutinePlaybackInterruption({ name: "AbortError" })).toBe(true);
  });

  it.each([
    ["NotSupportedError", "The element has no supported sources."],
    ["NotAllowedError", "play() failed because the user didn't interact with the document first."],
    ["EncodingError", "The media could not be decoded."],
  ])("keeps a %s fatal", (name, message) => {
    expect(isRoutinePlaybackInterruption(domException(name, message))).toBe(false);
  });

  it.each([
    ["a plain Error", new Error("AbortError")],
    ["a bare string", "AbortError"],
    ["null", null],
    ["undefined", undefined],
    ["a non-string name", { name: 42 }],
  ])("keeps %s fatal rather than guessing", (_label, error) => {
    // Note the first case: the prose says "AbortError" and the name does not.
    // Messages are browser copy and localized, so they never decide this.
    expect(isRoutinePlaybackInterruption(error)).toBe(false);
  });
});
