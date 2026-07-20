import {
  isFizzAiModelUsable,
  schemaFields,
  type FizzAiCatalog,
  type FizzAiModel,
} from "@/app/[locale]/canvas/_lib/generation-api";
import type {
  StoryReferenceKind,
  StoryReferenceSlot,
  StoryVideoGenerationMode,
  StoryVideoGenerationReferenceInput,
  StoryVideoGenerationReferenceRole,
} from "@/lib/story-projects-api";

export const STORY_VIDEO_GENERATION_MODES = [
  "multimodal_to_video",
  "first_last_frame_to_video",
] as const satisfies readonly StoryVideoGenerationMode[];

const STORY_DURATION_FIELDS = new Set(["duration", "durationSeconds", "duration_seconds"]);

export interface StoryVideoDurationContract {
  defaultMs: number;
  optionsMs: number[];
  minMs: number;
  maxMs: number;
}

function durationScalarMs(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const seconds = typeof value === "number" ? value : Number.parseFloat(value.trim());
  if (!Number.isFinite(seconds)) return null;
  const milliseconds = Math.round(seconds * 1_000);
  return Number.isInteger(milliseconds) && milliseconds >= 1_000 && milliseconds <= 600_000
    ? milliseconds
    : null;
}

export function storyVideoDurationContract(
  model: FizzAiModel | undefined
): StoryVideoDurationContract | null {
  const field = schemaFields(model).find(
    (candidate) => STORY_DURATION_FIELDS.has(candidate.name) && candidate.control !== "hidden"
  );
  if (!field) return null;

  const optionsMs = [
    ...new Set(
      (field.enum ?? []).flatMap((value) => {
        const durationMs = durationScalarMs(value);
        return durationMs === null ? [] : [durationMs];
      })
    ),
  ].sort((left, right) => left - right);
  const minMs = durationScalarMs(field.min) ?? optionsMs[0] ?? 1_000;
  const maxMs = durationScalarMs(field.max) ?? optionsMs.at(-1) ?? 600_000;
  if (minMs > maxMs) return null;
  const declaredDefaultMs = durationScalarMs(field.default);
  const defaultMs = declaredDefaultMs ?? optionsMs[0] ?? minMs;
  if (defaultMs < minMs || defaultMs > maxMs) return null;
  if (optionsMs.length > 0 && !optionsMs.includes(defaultMs)) return null;
  return { defaultMs, optionsMs, minMs, maxMs };
}

/**
 * The story modes a model can drive, in canonical order. Empty when the model
 * offers neither story mode.
 */
export function supportedStoryVideoModes(
  model: FizzAiModel | undefined
): StoryVideoGenerationMode[] {
  if (!model) return [];
  const modes = model.generationModes ?? [];
  return STORY_VIDEO_GENERATION_MODES.filter((mode) => modes.includes(mode));
}

/**
 * Every usable video model that can drive AT LEAST ONE story mode and declares
 * a valid duration contract. The single model dropdown spans both modes; the
 * selected model's own supported modes gate the per-recipe mode toggle.
 */
export function filterStoryVideoModels(
  catalog: FizzAiCatalog | undefined
): FizzAiCatalog | undefined {
  if (!catalog) return undefined;
  return {
    ...catalog,
    models: catalog.models.filter(
      (model) =>
        model.type === "video" &&
        isFizzAiModelUsable(model) &&
        supportedStoryVideoModes(model).length > 0 &&
        storyVideoDurationContract(model) !== null
    ),
  };
}

export function selectedStoryVideoModel(
  catalog: FizzAiCatalog | undefined,
  modelId: string
): FizzAiModel | undefined {
  if (!modelId) return undefined;
  return catalog?.models.find((model) => model.id === modelId);
}

export function countBillableRecipeReferences(
  references: readonly StoryVideoGenerationReferenceInput[]
): number {
  return new Set(references.map((reference) => reference.referenceVersionId)).size;
}

export interface StoryComposerReferenceItem {
  referenceVersionId: string;
  slotId: string;
  label: string;
  kind: StoryReferenceKind;
  role: StoryVideoGenerationReferenceRole;
  previewUrl: string | null;
}

export interface StoryComposerAddableSlot {
  slotId: string;
  referenceVersionId: string;
  label: string;
  kind: StoryReferenceKind;
  previewUrl: string | null;
  role: StoryVideoGenerationReferenceRole;
}

function approvedVersion(slot: StoryReferenceSlot) {
  if (!slot.approvedVersionId) return null;
  return slot.versions.find((version) => version.id === slot.approvedVersionId) ?? null;
}

export function storyComposerReferenceItems(
  references: readonly StoryVideoGenerationReferenceInput[],
  slots: readonly StoryReferenceSlot[]
): StoryComposerReferenceItem[] {
  const versionIndex = new Map(
    slots.flatMap((slot) =>
      slot.versions.map((version) => [version.id, { slot, version }] as const)
    )
  );
  return references.flatMap((reference) => {
    const match = versionIndex.get(reference.referenceVersionId);
    if (!match) return [];
    return [
      {
        referenceVersionId: reference.referenceVersionId,
        slotId: match.slot.id,
        label: match.slot.label,
        kind: match.slot.kind,
        role: reference.role,
        previewUrl: match.version.asset.previewUrl,
      },
    ];
  });
}

function referenceRoleForSlot(
  mode: StoryVideoGenerationMode,
  kind: StoryReferenceKind,
  occupiedRoles: ReadonlySet<StoryVideoGenerationReferenceRole>
): StoryVideoGenerationReferenceRole | null {
  if (mode === "multimodal_to_video") {
    return ["character", "location", "prop", "graphic", "style"].includes(kind)
      ? "reference"
      : null;
  }
  if (kind === "first_frame") return occupiedRoles.has("first_frame") ? null : "first_frame";
  if (kind === "last_frame") return occupiedRoles.has("last_frame") ? null : "last_frame";
  if (kind !== "join_frame") return null;
  if (!occupiedRoles.has("first_frame")) return "first_frame";
  return occupiedRoles.has("last_frame") ? null : "last_frame";
}

export function storyComposerAddableSlots(
  mode: StoryVideoGenerationMode,
  references: readonly StoryVideoGenerationReferenceInput[],
  slots: readonly StoryReferenceSlot[]
): StoryComposerAddableSlot[] {
  const selectedVersions = new Set(references.map((reference) => reference.referenceVersionId));
  const occupiedRoles = new Set(references.map((reference) => reference.role));
  return [...slots]
    .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id))
    .flatMap((slot) => {
      const version = approvedVersion(slot);
      if (!version || selectedVersions.has(version.id)) return [];
      const role = referenceRoleForSlot(mode, slot.kind, occupiedRoles);
      if (!role) return [];
      if (mode === "multimodal_to_video" && references.length >= 12) return [];
      return [
        {
          slotId: slot.id,
          referenceVersionId: version.id,
          label: slot.label,
          kind: slot.kind,
          previewUrl: version.asset.previewUrl,
          role,
        },
      ];
    });
}

export function addStoryRecipeReference(
  references: readonly StoryVideoGenerationReferenceInput[],
  referenceVersionId: string,
  role: StoryVideoGenerationReferenceRole
): StoryVideoGenerationReferenceInput[] {
  if (references.some((reference) => reference.referenceVersionId === referenceVersionId)) {
    return [...references];
  }
  return [...references, { referenceVersionId, role }];
}

export function removeStoryRecipeReference(
  references: readonly StoryVideoGenerationReferenceInput[],
  referenceVersionId: string
): StoryVideoGenerationReferenceInput[] {
  return references.filter((reference) => reference.referenceVersionId !== referenceVersionId);
}

/**
 * Re-validate a recipe's references against a (possibly new) mode: multimodal
 * keeps only the `reference`-role images (capped at 12); first/last-frame keeps
 * at most one first-frame and one last-frame. A mode switch therefore drops the
 * roles that don't belong to the destination mode, leaving the recipe valid.
 */
export function pruneStoryRecipeReferencesForMode(
  mode: StoryVideoGenerationMode,
  references: readonly StoryVideoGenerationReferenceInput[]
): StoryVideoGenerationReferenceInput[] {
  if (mode === "multimodal_to_video") {
    return references.filter((reference) => reference.role === "reference").slice(0, 12);
  }
  const first = references.find((reference) => reference.role === "first_frame");
  const last = references.find((reference) => reference.role === "last_frame");
  return [first, last].filter((reference): reference is StoryVideoGenerationReferenceInput =>
    Boolean(reference)
  );
}

/**
 * The reference slot a free-form upload should become for the active mode, or
 * `null` when the plan is already full. Multimodal uploads land as a generic
 * `graphic` reference; first/last-frame uploads fill the first empty frame.
 */
export function storyFreeformUploadTarget(
  mode: StoryVideoGenerationMode,
  references: readonly StoryVideoGenerationReferenceInput[]
): { kind: StoryReferenceKind; role: StoryVideoGenerationReferenceRole } | null {
  if (mode === "multimodal_to_video") {
    return references.length >= 12 ? null : { kind: "graphic", role: "reference" };
  }
  const occupied = new Set(references.map((reference) => reference.role));
  if (!occupied.has("first_frame")) return { kind: "first_frame", role: "first_frame" };
  if (!occupied.has("last_frame")) return { kind: "last_frame", role: "last_frame" };
  return null;
}

export function isStoryRecipeReferencePlanValid(
  mode: StoryVideoGenerationMode,
  references: readonly StoryVideoGenerationReferenceInput[]
): boolean {
  const versionIds = new Set(references.map((reference) => reference.referenceVersionId));
  if (versionIds.size !== references.length) return false;
  if (mode === "multimodal_to_video") {
    return (
      references.length <= 12 && references.every((reference) => reference.role === "reference")
    );
  }
  return (
    references.length === 2 &&
    references.filter((reference) => reference.role === "first_frame").length === 1 &&
    references.filter((reference) => reference.role === "last_frame").length === 1
  );
}
