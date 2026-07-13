import type { FizzAiCatalog } from "@/app/[locale]/canvas/_lib/generation-api";
import type {
  FilmClipSummary,
  FilmGenerationControl,
  FilmReferenceKind,
  FilmReferenceSlot,
  FilmTrailerSummary,
} from "@/lib/story-projects-api";
import {
  roleMatchesSlotKind,
  type StoryReferenceBindingInput,
} from "./story-clip-reference-bindings-model";

type StoryProductionTarget = FilmClipSummary | FilmTrailerSummary;

/** Story production supports omni reference and first+last frame lock. */
const STORY_VIDEO_GENERATION_MODES = ["multimodal_to_video", "first_last_frame_to_video"] as const;

export function filterStoryVideoCatalog(catalog: FizzAiCatalog | undefined) {
  if (!catalog) return undefined;
  return {
    ...catalog,
    models: catalog.models.filter(
      (model) =>
        model.type === "video" &&
        STORY_VIDEO_GENERATION_MODES.every((mode) => model.generationModes?.includes(mode))
    ),
  } satisfies FizzAiCatalog;
}

export function countBillableBoundReferences(target: StoryProductionTarget | null): number {
  if (!target) return 0;
  const approvedVersions = new Set<string>();
  target.referenceBindings.forEach((binding) => {
    if (
      binding.approvedReferenceVersionId &&
      referenceRoleAllowed(target.generationControl, binding.role)
    ) {
      approvedVersions.add(binding.approvedReferenceVersionId);
    }
  });
  return approvedVersions.size;
}

function referenceRoleAllowed(
  control: FilmGenerationControl,
  role: StoryProductionTarget["referenceBindings"][number]["role"]
): boolean {
  if (control.mode === "omni_reference") {
    return role !== "first_frame" && role !== "last_frame";
  }
  return (
    role === "first_frame" || (control.frameMode === "first_last_frame" && role === "last_frame")
  );
}

export interface StoryComposerReferenceItem {
  bindingId: string;
  slotId: string;
  label: string;
  kind: FilmReferenceKind;
  required: boolean;
  approved: boolean;
  previewUrl: string | null;
}

export interface StoryComposerAddableSlot {
  slotId: string;
  label: string;
  kind: FilmReferenceKind;
  previewUrl: string | null;
  /** The binding role this slot would attach with under the current mode. */
  role: StoryReferenceBindingInput["role"];
}

function slotPreviewUrl(slot: FilmReferenceSlot): string | null {
  if (!slot.approvedVersionId) return null;
  return (
    slot.versions.find((version) => version.id === slot.approvedVersionId)?.asset.previewUrl ?? null
  );
}

/** The reference chips shown in the composer: the target's current bindings. */
export function storyComposerReferenceItems(
  target: StoryProductionTarget | null,
  slots: readonly FilmReferenceSlot[]
): StoryComposerReferenceItem[] {
  if (!target) return [];
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]));
  return [...target.referenceBindings]
    .filter((binding) => referenceRoleAllowed(target.generationControl, binding.role))
    .sort((left, right) => left.rank - right.rank)
    .map((binding) => {
      const slot = slotsById.get(binding.referenceSlotId);
      return {
        bindingId: binding.id,
        slotId: binding.referenceSlotId,
        label: slot?.label ?? binding.referenceSlotId,
        kind: slot?.kind ?? "style",
        required: binding.required,
        approved: Boolean(binding.approvedReferenceVersionId),
        previewUrl: slot ? slotPreviewUrl(slot) : null,
      };
    });
}

/** Which role an unbound slot would attach with under the given control. */
function addableRoleForSlot(
  control: FilmGenerationControl,
  kind: FilmReferenceKind
): StoryReferenceBindingInput["role"] | null {
  if (control.mode === "omni_reference") {
    return roleMatchesSlotKind("omni", kind) ? "omni" : null;
  }
  if (kind === "last_frame") return "last_frame";
  // Join frames chain clips together; when attached ad hoc they anchor the
  // clip's opening, so they default to the first-frame role.
  if (kind === "first_frame" || kind === "join_frame") return "first_frame";
  return null;
}

/** Approved, mode-compatible slots that the target does not bind yet. */
export function storyComposerAddableSlots(
  target: StoryProductionTarget | null,
  slots: readonly FilmReferenceSlot[]
): StoryComposerAddableSlot[] {
  if (!target) return [];
  const bound = new Set(target.referenceBindings.map((binding) => binding.referenceSlotId));
  return [...slots]
    .filter((slot) => !bound.has(slot.id) && Boolean(slot.approvedVersionId))
    .sort((left, right) => left.rank - right.rank)
    .flatMap((slot) => {
      const role = addableRoleForSlot(target.generationControl, slot.kind);
      if (!role) return [];
      return [
        {
          slotId: slot.id,
          label: slot.label,
          kind: slot.kind,
          previewUrl: slotPreviewUrl(slot),
          role,
        },
      ];
    });
}

function bindingsAsInput(target: StoryProductionTarget): StoryReferenceBindingInput[] {
  return target.referenceBindings.map(({ referenceSlotId, role, rank, required }) => ({
    referenceSlotId,
    role,
    rank,
    required,
  }));
}

export function storyReferenceBindingsWith(
  target: StoryProductionTarget,
  slotId: string,
  role: StoryReferenceBindingInput["role"]
): StoryReferenceBindingInput[] {
  const current = bindingsAsInput(target);
  if (current.some((binding) => binding.referenceSlotId === slotId)) return current;
  const nextRank = current.reduce((max, binding) => Math.max(max, binding.rank), -1) + 1;
  return [...current, { referenceSlotId: slotId, role, rank: nextRank, required: false }];
}

export function storyReferenceBindingsWithout(
  target: StoryProductionTarget,
  slotId: string
): StoryReferenceBindingInput[] {
  return bindingsAsInput(target).filter((binding) => binding.referenceSlotId !== slotId);
}
