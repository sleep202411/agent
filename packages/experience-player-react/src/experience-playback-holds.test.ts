import { describe, expect, it } from "vitest";
import {
  nextExperienceViewerPause,
  resolveExperiencePlaybackHolds,
  type ExperiencePlaybackGates,
  type ExperienceViewerPauseReason,
} from "./experience-playback-holds";

/**
 * The player's playback state is these two functions: which holds a set of
 * gates puts on story time, Web Audio and the clips, and how the viewer's
 * pause moves. The host decides every hold with the first and every pause and
 * resume with the second, so the state machine is asserted here, without a
 * media element or a render.
 */

const playing: ExperiencePlaybackGates = {
  started: true,
  ended: false,
  failed: false,
  viewerPause: null,
  accessPending: false,
  retryAccess: false,
  nodeGate: false,
  chargeGate: false,
};

const holds = (gates: Partial<ExperiencePlaybackGates>) =>
  resolveExperiencePlaybackHolds({ ...playing, ...gates });

describe("resolveExperiencePlaybackHolds", () => {
  it("suspends a mounted run completely while its independent main menu is open", () => {
    expect(holds({ mainMenu: true })).toEqual({
      running: true,
      storyHeld: true,
      audioHeld: true,
      mediaHeld: true,
      pauseUi: false,
    });
  });
  it("holds nothing while the story plays", () => {
    expect(holds({})).toEqual({
      running: true,
      storyHeld: false,
      audioHeld: false,
      mediaHeld: false,
      pauseUi: true,
    });
  });

  it("holds story time and the clips behind the title card, but not Web Audio, which Start unlocks", () => {
    expect(holds({ started: false })).toEqual({
      running: false,
      storyHeld: true,
      audioHeld: false,
      mediaHeld: true,
      pauseUi: false,
    });
  });

  it.each<ExperienceViewerPauseReason>(["user", "hidden", "refused"])(
    "holds all of it while the viewer pause is %s, and keeps the pause controls",
    (viewerPause) => {
      expect(holds({ viewerPause })).toEqual({
        running: true,
        storyHeld: true,
        audioHeld: true,
        mediaHeld: true,
        pauseUi: true,
      });
    }
  );

  it.each<Partial<ExperiencePlaybackGates>>([{ accessPending: true }, { retryAccess: true }])(
    "holds all of it through an access flow (%o), with the pause controls out of its way",
    (gate) => {
      expect(holds(gate)).toEqual({
        running: true,
        storyHeld: true,
        audioHeld: true,
        mediaHeld: true,
        pauseUi: false,
      });
    }
  );

  it("holds only the clip for a charge, whose idle timeout is story time and must run", () => {
    expect(holds({ chargeGate: true })).toEqual({
      running: true,
      storyHeld: false,
      audioHeld: false,
      mediaHeld: true,
      pauseUi: true,
    });
  });

  it("leaves Web Audio to the ending's cues, and holds the rest", () => {
    expect(holds({ ended: true })).toEqual({
      running: false,
      storyHeld: true,
      audioHeld: false,
      mediaHeld: true,
      pauseUi: false,
    });
  });

  it("holds all of it on a failure", () => {
    expect(holds({ failed: true })).toEqual({
      running: false,
      storyHeld: true,
      audioHeld: true,
      mediaHeld: true,
      pauseUi: false,
    });
  });

  it("keeps the pause controls off the locked-scene gate", () => {
    expect(holds({ nodeGate: true }).pauseUi).toBe(false);
  });
});

describe("nextExperienceViewerPause", () => {
  const running = { running: true, pauseUi: true };

  it.each<ExperienceViewerPauseReason>(["user", "hidden", "refused"])(
    "pauses a playing story for %s",
    (reason) => {
      expect(nextExperienceViewerPause(null, { type: "pause", reason }, running)).toBe(reason);
    }
  );

  it.each([
    { label: "behind the title card", gates: { started: false } },
    { label: "at the ending", gates: { ended: true } },
    { label: "on a failure", gates: { failed: true } },
  ])("does not pause a story that is not running: $label", ({ gates }) => {
    expect(
      nextExperienceViewerPause(null, { type: "pause", reason: "refused" }, holds(gates))
    ).toBeNull();
  });

  it("records a pause through an access flow, so finishing it does not play behind the viewer", () => {
    expect(
      nextExperienceViewerPause(
        null,
        { type: "pause", reason: "hidden" },
        holds({ accessPending: true })
      )
    ).toBe("hidden");
  });

  it("lets a refusal replace any other reason, and nothing replace a refusal", () => {
    expect(nextExperienceViewerPause("user", { type: "pause", reason: "refused" }, running)).toBe(
      "refused"
    );
    expect(nextExperienceViewerPause("hidden", { type: "pause", reason: "refused" }, running)).toBe(
      "refused"
    );
    expect(nextExperienceViewerPause("refused", { type: "pause", reason: "user" }, running)).toBe(
      "refused"
    );
    expect(nextExperienceViewerPause("refused", { type: "pause", reason: "hidden" }, running)).toBe(
      "refused"
    );
    // The first reason stands among the others.
    expect(nextExperienceViewerPause("user", { type: "pause", reason: "hidden" }, running)).toBe(
      "user"
    );
  });

  it.each<ExperienceViewerPauseReason>(["user", "hidden", "refused"])(
    "resumes from %s on a tap or a key",
    (current) => {
      expect(
        nextExperienceViewerPause(current, { type: "resume", source: "gesture" }, running)
      ).toBeNull();
    }
  );

  it("resumes a viewer or system pause from the OS media controls, but never a refusal", () => {
    const system = { type: "resume", source: "system" } as const;
    expect(nextExperienceViewerPause("user", system, running)).toBeNull();
    expect(nextExperienceViewerPause("hidden", system, running)).toBeNull();
    // Only a tap makes the element playable again.
    expect(nextExperienceViewerPause("refused", system, running)).toBe("refused");
  });

  it("does not resume behind an access flow or the locked-scene gate", () => {
    const gesture = { type: "resume", source: "gesture" } as const;
    expect(nextExperienceViewerPause("user", gesture, holds({ accessPending: true }))).toBe("user");
    expect(nextExperienceViewerPause("user", gesture, holds({ nodeGate: true }))).toBe("user");
  });

  it("has nothing to resume while playing", () => {
    expect(
      nextExperienceViewerPause(null, { type: "resume", source: "gesture" }, running)
    ).toBeNull();
  });
});
