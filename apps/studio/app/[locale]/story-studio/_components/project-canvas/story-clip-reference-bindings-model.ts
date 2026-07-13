import type { FilmReferenceKind } from "@/lib/story-projects-api";

export type StoryReferenceBindingInput = {
  referenceSlotId: string;
  role: "omni" | "first_frame" | "last_frame" | "continuity" | "style";
  rank: number;
  required: boolean;
};

type StoryReferenceGenerationControl =
  | { mode: "omni_reference" }
  | { mode: "frame_lock"; frameMode: "first_frame" | "first_last_frame" };

type StoryReferenceBindingSignatureInput = Pick<
  StoryReferenceBindingInput,
  "referenceSlotId" | "role" | "rank" | "required"
>;

export function storyReferenceBindingsSignature(
  bindings: readonly StoryReferenceBindingSignatureInput[]
): string {
  const normalized = bindings
    .map(({ referenceSlotId, role, rank, required }) => ({
      referenceSlotId,
      role,
      rank,
      required,
    }))
    .sort(
      (left, right) =>
        left.role.localeCompare(right.role) ||
        left.rank - right.rank ||
        left.referenceSlotId.localeCompare(right.referenceSlotId) ||
        Number(left.required) - Number(right.required)
    );
  return JSON.stringify(normalized);
}

export function storyReferenceBindingEditorKey(
  targetId: string,
  bindings: readonly StoryReferenceBindingSignatureInput[]
): string {
  return `${targetId}:${storyReferenceBindingsSignature(bindings)}`;
}

/** Mirrors the authoritative role/kind compatibility enforced by the API. */
export function roleMatchesSlotKind(
  role: StoryReferenceBindingInput["role"],
  kind: FilmReferenceKind
): boolean {
  if (role === "omni") {
    return ["character", "location", "prop", "graphic", "style"].includes(kind);
  }
  if (role === "first_frame" || role === "last_frame") {
    return ["first_frame", "last_frame", "join_frame"].includes(kind);
  }
  if (role === "continuity") {
    return ["character", "location", "prop", "graphic"].includes(kind);
  }
  return role === "style" && kind === "style";
}

export function areStoryReferenceBindingKindsValid(
  bindings: readonly StoryReferenceBindingInput[],
  slots: readonly { id: string; kind: FilmReferenceKind }[]
): boolean {
  const kindBySlotId = new Map(slots.map((slot) => [slot.id, slot.kind]));
  return bindings.every((binding) => {
    const kind = kindBySlotId.get(binding.referenceSlotId);
    return Boolean(kind && roleMatchesSlotKind(binding.role, kind));
  });
}

export function isStoryReferenceBindingPlanValid(
  control: StoryReferenceGenerationControl,
  bindings: StoryReferenceBindingInput[]
): boolean {
  const roles = new Set(bindings.map((binding) => binding.role));
  if (control.mode === "omni_reference") {
    return roles.has("omni") && !roles.has("first_frame") && !roles.has("last_frame");
  }
  if (roles.has("omni") || !roles.has("first_frame")) return false;
  return control.frameMode === "first_last_frame"
    ? roles.has("last_frame")
    : !roles.has("last_frame");
}
