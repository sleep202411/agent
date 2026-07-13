import { describe, expect, it } from "vitest";
import type { StoryClipPromptDraft } from "@/lib/story-projects-api";
import { compileDirectorPromptManifest } from "./story-director-prompt-compiler";

describe("Seedance director prompt compiler", () => {
  it("compiles every structured authoring section in deterministic timeline order", () => {
    const prompt = fixture();

    const compiled = compileDirectorPromptManifest(prompt);

    expect(compiled).toContain("# The threshold");
    expect(compiled).toContain("Clip: SCENE_1 | Duration: 15.0s | Generation: First + Last Frame");
    expect(compiled).toContain("[subject] hero — Preserve face and wardrobe identity");
    expect(compiled).toContain("[0.0s–5.0s] Beat 1");
    expect(compiled).toContain("Performance: Held breath, then resolve");
    expect(compiled).toContain("End state: Hand reaches the latch");
    expect(compiled).toContain("NEGATIVE CONSTRAINTS\n\n- No identity drift");
    expect(compiled).toContain("CONTINUITY NOTES\n\n- Silver key remains in left hand");
    expect(compiled.indexOf("[0.0s–5.0s]")).toBeLessThan(compiled.indexOf("[5.0s–15.0s]"));
    expect(prompt).toEqual(fixture());
  });

  it("keeps an incomplete mutable prompt previewable without leaking undefined values", () => {
    const prompt = fixture({
      title: "",
      description: "",
      masterDirection: "",
      emotionalArc: "",
      referenceRoleNotes: [],
      beats: [],
      negativeConstraints: [""],
      continuityNotes: [""],
      generationControl: { mode: "omni_reference" },
    });

    const compiled = compileDirectorPromptManifest(prompt);

    expect(compiled).toContain("# SCENE_1");
    expect(compiled).toContain("Generation: Omni Reference");
    expect(compiled).toContain("No time-coded beats authored.");
    expect(compiled).not.toContain("undefined");
  });

  it("preserves long-form authoring for later provider-specific compaction", () => {
    const compiled = compileDirectorPromptManifest(
      fixture({ masterDirection: "direction ".repeat(600) })
    );

    expect(compiled.length).toBeGreaterThan(4_000);
    expect(compiled).toContain("direction direction direction");
  });
});

function fixture(overrides: Partial<StoryClipPromptDraft> = {}): StoryClipPromptDraft {
  return {
    graphNodeId: "clip:scene-1",
    clipKey: "SCENE_1",
    title: "The threshold",
    description: "A tense approach to a sealed door.",
    targetDurationMs: 15_000,
    generationControl: { mode: "frame_lock", frameMode: "first_last_frame" },
    masterDirection: "One continuous cinematic move with grounded photorealism.",
    referenceRoleNotes: [
      {
        id: "reference:1",
        role: "subject",
        referenceId: "hero",
        note: "Preserve face and wardrobe identity",
      },
    ],
    emotionalArc: "Suspicion tightens into resolve.",
    beats: [
      {
        id: "beat:1",
        startMs: 0,
        endMs: 5_000,
        visual: "Hero enters the moonlit corridor.",
        camera: "Slow shoulder-height dolly in.",
        action: "The hero stops at the sealed door.",
        performance: "Held breath, then resolve",
        emotion: "Contained dread",
        dialogue: "Who is there?",
        audio: "Distant metal resonance",
        endState: "Hand reaches the latch",
        continuity: "Silver key remains in left hand",
      },
      {
        id: "beat:2",
        startMs: 5_000,
        endMs: 15_000,
        visual: "The door opens into darkness.",
        camera: "Push through over the shoulder.",
        action: "Hero crosses the threshold.",
        performance: "",
        emotion: "Resolve",
        dialogue: "",
        audio: "Hinge creak",
        endState: "Hero disappears into the room",
        continuity: "",
      },
    ],
    negativeConstraints: ["No identity drift"],
    continuityNotes: ["Silver key remains in left hand"],
    ...overrides,
  };
}
