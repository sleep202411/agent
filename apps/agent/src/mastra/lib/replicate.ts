/**
 * Replicate provider for AI SDK's image generation path.
 *
 * Phase 1 picks FLUX schnell — cheapest + fastest on Replicate (~$0.003 / image,
 * 2-4s wall clock with 4 inference steps). Quality is "good enough" for
 * character/scene/prop reference images where speed matters more than
 * cinematic fidelity. Quality tier can swap later via the MODEL_ID env.
 *
 * Token: REPLICATE_API_TOKEN (get one at https://replicate.com/account/api-tokens).
 * When missing, the provider throws at call time; the worker catches and marks
 * the asset imageStatus=failed_config so the UI shows a retry button.
 */
import { createReplicate } from "@ai-sdk/replicate";

export const REPLICATE_IMAGE_MODEL =
  (process.env.REPLICATE_IMAGE_MODEL as `${string}/${string}` | undefined) ??
  "black-forest-labs/flux-schnell";

let cachedProvider: ReturnType<typeof createReplicate> | null = null;

/**
 * Returns a memoized Replicate provider. Throws only when the consumer
 * actually tries to generate (via .image()), so code paths that never hit
 * Replicate don't crash on boot when the token isn't set in local dev.
 */
export function getReplicate() {
  if (cachedProvider) return cachedProvider;
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    throw new Error(
      "REPLICATE_API_TOKEN is not set — cannot generate images. Get a token at https://replicate.com/account/api-tokens and add it to .env."
    );
  }
  cachedProvider = createReplicate({ apiToken });
  return cachedProvider;
}

export function getImageModel() {
  return getReplicate().image(REPLICATE_IMAGE_MODEL);
}
