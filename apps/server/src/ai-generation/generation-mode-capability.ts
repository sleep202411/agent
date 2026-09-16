/**
 * Single authority for "can this model serve this generation request".
 *
 * The canonical model's `generationModes` (admin-curated, ai_canonical_models.
 * generation_modes) is the ONLY source of capability truth at quote/selection
 * time. Provider bindings describe parameter mapping (e.g. startFrame ->
 * image_url); they must not independently decide semantics — a mis-declared
 * binding once let a text-only storyboard quote route to an i2v-only
 * deployment and fail at the provider AFTER billing admission.
 *
 * Every selection path (explicit modelId, persisted preference, and the
 * no-preference resolver fallback) consults the same helpers below, so a
 * mode-incompatible model can never be quoted, billed, or dispatched.
 */
import type { AiGenerationMode } from './types';

/** Modes that can serve a prompt-only (no reference) request. */
const TEXT_ONLY_MODES: ReadonlySet<AiGenerationMode> = new Set([
  'text_to_image',
  'text_to_video',
  'text_to_audio',
] as AiGenerationMode[]);

/** Modes that can consume at least one image reference. */
const IMAGE_REF_MODES: ReadonlySet<AiGenerationMode> = new Set([
  'image_to_image',
  'image_to_video',
  'inpainting',
  'outpainting',
  'upscale',
  'remove_background',
  'relight',
  'multi_angle',
  'reference_image_generation',
  'first_last_frame_to_video',
  'multimodal_to_image',
  'multimodal_to_video',
] as AiGenerationMode[]);

/** Modes that can consume at least one video reference. */
const VIDEO_REF_MODES: ReadonlySet<AiGenerationMode> = new Set([
  'video_to_video',
  'multimodal_to_image',
  'multimodal_to_video',
] as AiGenerationMode[]);

export interface GenerationRequestShape {
  kind: 'image' | 'video';
  imageReferences: number;
  videoReferences: number;
}

/** Human-readable label for error copy. */
export function describeGenerationRequestShape(
  shape: GenerationRequestShape,
): string {
  if (shape.videoReferences > 0) {
    return `${shape.kind} generation with video references`;
  }
  if (shape.imageReferences > 0) {
    return `${shape.kind} generation with image references`;
  }
  return `text-only ${shape.kind} generation`;
}

/**
 * Derive the request shape from a target's resolved references. Callers pass
 * each reference's media kind (e.g. `reference.binding.kind`) so this module
 * stays independent of the Story target types.
 */
export function generationRequestShape(
  kind: 'image' | 'video',
  referenceKinds: readonly ('image' | 'video')[],
): GenerationRequestShape {
  return {
    kind,
    imageReferences: referenceKinds.filter(
      (referenceKind) => referenceKind === 'image',
    ).length,
    videoReferences: referenceKinds.filter(
      (referenceKind) => referenceKind === 'video',
    ).length,
  };
}

/**
 * The set of modes that could serve this request shape. A model supports the
 * request when at least one of its `generationModes` is in this set.
 */
export function modesServingRequest(
  shape: GenerationRequestShape,
): ReadonlySet<AiGenerationMode> {
  if (shape.videoReferences > 0) return VIDEO_REF_MODES;
  if (shape.imageReferences > 0) return IMAGE_REF_MODES;
  return TEXT_ONLY_MODES;
}

export function modelSupportsRequest(
  generationModes: readonly AiGenerationMode[],
  shape: GenerationRequestShape,
): boolean {
  const serving = modesServingRequest(shape);
  return generationModes.some((mode) => serving.has(mode));
}

/** Parse the canonical's JSONB generation_modes column defensively. */
export function parseCanonicalGenerationModes(
  raw: unknown,
): AiGenerationMode[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (mode): mode is AiGenerationMode => typeof mode === 'string',
  );
}
