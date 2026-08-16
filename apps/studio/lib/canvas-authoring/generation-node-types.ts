/**
 * Stable canvas identities for generation nodes.
 *
 * Node type strings are persisted in collaborative canvas documents forever,
 * so modality and node identity live in one append-only contract instead of
 * being re-derived independently by creation, rendering, wiring and jobs.
 */
export const GENERATION_NODE_TYPE = {
  image: "prompt",
  video: "video",
  audio: "audio",
} as const;

export type GenerationModality = keyof typeof GENERATION_NODE_TYPE;
export type GenerationNodeTypeId = (typeof GENERATION_NODE_TYPE)[GenerationModality];

const GENERATION_MODALITY_BY_NODE_TYPE: Readonly<Record<GenerationNodeTypeId, GenerationModality>> =
  {
    prompt: "image",
    video: "video",
    audio: "audio",
  };

export function generationNodeTypeForModality(modality: GenerationModality): GenerationNodeTypeId {
  return GENERATION_NODE_TYPE[modality];
}

export function generationModalityForNodeType(
  nodeType: string | null | undefined
): GenerationModality | undefined {
  return nodeType && nodeType in GENERATION_MODALITY_BY_NODE_TYPE
    ? GENERATION_MODALITY_BY_NODE_TYPE[nodeType as GenerationNodeTypeId]
    : undefined;
}

export function isGenerationNodeType(
  nodeType: string | null | undefined
): nodeType is GenerationNodeTypeId {
  return generationModalityForNodeType(nodeType) !== undefined;
}
