import { describe, expect, it } from "vitest";
import {
  areStoryReferenceBindingKindsValid,
  isStoryReferenceBindingPlanValid,
  roleMatchesSlotKind,
  storyReferenceBindingEditorKey,
  storyReferenceBindingsSignature,
  type StoryReferenceBindingInput,
} from "./story-clip-reference-bindings-model";

describe("storyReferenceBindingsSignature", () => {
  const current = [
    binding("omni", { referenceSlotId: "slot-a", rank: 0, required: true }),
    binding("style", { referenceSlotId: "slot-b", rank: 1, required: false }),
  ];

  it("is order-independent and changes for every server-owned binding field", () => {
    expect(storyReferenceBindingsSignature([...current].reverse())).toBe(
      storyReferenceBindingsSignature(current)
    );
    expect(
      storyReferenceBindingsSignature([current[0], { ...current[1], referenceSlotId: "slot-c" }])
    ).not.toBe(storyReferenceBindingsSignature(current));
    expect(
      storyReferenceBindingsSignature([current[0], { ...current[1], role: "continuity" }])
    ).not.toBe(storyReferenceBindingsSignature(current));
    expect(storyReferenceBindingsSignature([current[0], { ...current[1], rank: 2 }])).not.toBe(
      storyReferenceBindingsSignature(current)
    );
    expect(
      storyReferenceBindingsSignature([current[0], { ...current[1], required: true }])
    ).not.toBe(storyReferenceBindingsSignature(current));
  });

  it("preserves local state for unchanged server bindings and remounts clip or trailer editors on change", () => {
    const original = storyReferenceBindingEditorKey("target-1", current);
    expect(storyReferenceBindingEditorKey("target-1", [...current].reverse())).toBe(original);
    expect(
      storyReferenceBindingEditorKey("target-1", [
        current[0],
        { ...current[1], referenceSlotId: "slot-c" },
      ])
    ).not.toBe(original);
    expect(storyReferenceBindingEditorKey("target-2", current)).not.toBe(original);
  });
});

describe("roleMatchesSlotKind", () => {
  it("keeps frame-only kinds out of the Omni picker", () => {
    for (const kind of ["character", "location", "prop", "graphic", "style"] as const) {
      expect(roleMatchesSlotKind("omni", kind)).toBe(true);
    }
    for (const kind of ["first_frame", "last_frame", "join_frame"] as const) {
      expect(roleMatchesSlotKind("omni", kind)).toBe(false);
    }
  });

  it("applies the API's frame-role compatibility to both frame selectors", () => {
    for (const role of ["first_frame", "last_frame"] as const) {
      for (const kind of ["first_frame", "last_frame", "join_frame"] as const) {
        expect(roleMatchesSlotKind(role, kind)).toBe(true);
      }
      for (const kind of ["character", "location", "prop", "graphic", "style"] as const) {
        expect(roleMatchesSlotKind(role, kind)).toBe(false);
      }
    }
  });

  it("keeps continuity and style roles aligned with the API", () => {
    expect(roleMatchesSlotKind("continuity", "character")).toBe(true);
    expect(roleMatchesSlotKind("continuity", "style")).toBe(false);
    expect(roleMatchesSlotKind("style", "style")).toBe(true);
    expect(roleMatchesSlotKind("style", "graphic")).toBe(false);
  });
});

describe("areStoryReferenceBindingKindsValid", () => {
  const slots = [
    { id: "character", kind: "character" as const },
    { id: "style", kind: "style" as const },
    { id: "first", kind: "first_frame" as const },
    { id: "last", kind: "last_frame" as const },
    { id: "join", kind: "join_frame" as const },
  ];

  it("rejects unknown and role-incompatible slots before save", () => {
    expect(
      areStoryReferenceBindingKindsValid([binding("omni", { referenceSlotId: "character" })], slots)
    ).toBe(true);
    expect(
      areStoryReferenceBindingKindsValid([binding("omni", { referenceSlotId: "first" })], slots)
    ).toBe(false);
    expect(
      areStoryReferenceBindingKindsValid(
        [binding("first_frame", { referenceSlotId: "join" })],
        slots
      )
    ).toBe(true);
    expect(
      areStoryReferenceBindingKindsValid(
        [binding("last_frame", { referenceSlotId: "style" })],
        slots
      )
    ).toBe(false);
    expect(
      areStoryReferenceBindingKindsValid([binding("omni", { referenceSlotId: "missing" })], slots)
    ).toBe(false);
  });
});

describe("isStoryReferenceBindingPlanValid", () => {
  it("requires Omni and rejects frame roles for Omni Reference", () => {
    expect(isStoryReferenceBindingPlanValid({ mode: "omni_reference" }, [binding("omni")])).toBe(
      true
    );
    expect(isStoryReferenceBindingPlanValid({ mode: "omni_reference" }, [])).toBe(false);
    expect(
      isStoryReferenceBindingPlanValid({ mode: "omni_reference" }, [
        binding("omni"),
        binding("first_frame"),
      ])
    ).toBe(false);
  });

  it("requires exactly the frame responsibilities declared by Frame Lock", () => {
    expect(
      isStoryReferenceBindingPlanValid({ mode: "frame_lock", frameMode: "first_frame" }, [
        binding("first_frame"),
      ])
    ).toBe(true);
    expect(
      isStoryReferenceBindingPlanValid({ mode: "frame_lock", frameMode: "first_frame" }, [
        binding("first_frame"),
        binding("last_frame"),
      ])
    ).toBe(false);
    expect(
      isStoryReferenceBindingPlanValid({ mode: "frame_lock", frameMode: "first_last_frame" }, [
        binding("first_frame"),
        binding("last_frame"),
      ])
    ).toBe(true);
  });
});

function binding(
  role: StoryReferenceBindingInput["role"],
  overrides: Partial<StoryReferenceBindingInput> = {}
): StoryReferenceBindingInput {
  return { referenceSlotId: role, role, rank: 0, required: true, ...overrides };
}
