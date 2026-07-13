import type { FizzAiCatalog } from "@/app/[locale]/canvas/_lib/generation-api";
import type {
  FilmClipSummary,
  FilmGenerationControl,
  FilmTrailerSummary,
} from "@/lib/story-projects-api";

type StoryProductionTarget = FilmClipSummary | FilmTrailerSummary;

const STORY_VIDEO_GENERATION_MODES = [
  "multimodal_to_video",
  "image_to_video",
  "first_last_frame_to_video",
] as const;

/** Only expose video models that can execute every Story clip control mode. */
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
