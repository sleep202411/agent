import type { CreateWorldRequest, WorldModelProviderKey } from "@repo/shared/world-model-protocol";
import { canonicalJsonString } from "@/lib/canonical-json";

export type StoryWorldCreationDraft = {
  prompt: string;
  firstFrameUrl: string;
  perspective: "first_person" | "third_person";
};

export const INITIAL_STORY_WORLD_CREATION_DRAFT: StoryWorldCreationDraft = {
  prompt: "",
  firstFrameUrl: "",
  perspective: "third_person",
};

/**
 * The provider-neutral translation from the inspector draft into the public
 * world-model contract. Keeping it outside React makes every creation surface
 * share the same request semantics without sharing UI state.
 */
export function buildStoryWorldCreateRequest(
  providerKey: WorldModelProviderKey,
  draft: StoryWorldCreationDraft
): CreateWorldRequest {
  return {
    providerKey,
    mode: "adventure",
    prompt: draft.prompt.trim(),
    eventStyle: "normal" as const,
    perspective: draft.perspective,
    reference: {
      ...(draft.firstFrameUrl.trim() ? { firstFrameUrl: draft.firstFrameUrl.trim() } : {}),
      imageUrls: [],
    },
  };
}

export async function buildStoryWorldCreateIdempotencyKey(
  projectId: string,
  nodeId: string,
  input: CreateWorldRequest
) {
  const bytes = new TextEncoder().encode(canonicalJsonString(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `story-world:${projectId}:${nodeId}:${fingerprint}`;
}
