import {
  EXPERIENCE_CORE_VIDEO_STILL_CAPABILITY,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import {
  EXPERIENCE_API_VERSION,
  EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER,
  EXPERIENCE_CORE_TEXT_RENDERER_ADAPTER,
  EXPERIENCE_CORE_CHOICE_RENDERER_ADAPTER,
  EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ADAPTER,
  EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ADAPTER,
  EXPERIENCE_ENGINE_API_VERSION,
  EXPERIENCE_ENGINE_BUILT_IN_CAPABILITIES,
  ExperienceRendererRegistry,
  ExperienceRuntimeController,
  type ExperienceAccessCheck,
  type PlaySessionReporter,
} from "@repo/experience-engine";

export interface ExperienceRuntimeOptions {
  randomSeed?: string;
  canAccess?: ExperienceAccessCheck;
  worldStreaming?: boolean;
  reporter?: PlaySessionReporter;
}

/**
 * Capabilities implemented by the native host itself rather than by the
 * headless engine or a renderer adapter. Keep this list next to the host
 * composition boundary so compatibility checks describe what the mounted
 * player can actually execute.
 */
const EXPERIENCE_NATIVE_HOST_CAPABILITIES = new Set([
  "input.tap",
  "input.swipe",
  "renderer.content-transform",
  // This host paints stills (ExperienceStillSegment), so it can play a
  // sequence that holds an image. A host without that branch must not declare
  // this — the whole point is that it is refused by name instead of showing an
  // empty frame.
  EXPERIENCE_CORE_VIDEO_STILL_CAPABILITY,
]);

/** Host adapter around the shared headless experience controller (web parity). */
export function createExperienceRuntime(
  manifest: ExperienceRuntimeManifest,
  options: ExperienceRuntimeOptions
): ExperienceRuntimeController {
  const rendererRegistry = new ExperienceRendererRegistry();
  // The shared adapter registry describes engine contracts, not native UI.
  // World streaming is injected only by the authenticated private-preview host.
  [
    EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER,
    EXPERIENCE_CORE_TEXT_RENDERER_ADAPTER,
    EXPERIENCE_CORE_CHOICE_RENDERER_ADAPTER,
    EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ADAPTER,
  ].forEach((adapter) => rendererRegistry.register(adapter));
  if (options.worldStreaming && manifest.channel === "preview")
    rendererRegistry.register(EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ADAPTER);
  const capabilities = new Set(EXPERIENCE_ENGINE_BUILT_IN_CAPABILITIES);
  rendererRegistry.capabilities().forEach((capability) => capabilities.add(capability));
  EXPERIENCE_NATIVE_HOST_CAPABILITIES.forEach((capability) => capabilities.add(capability));
  if (options.canAccess) capabilities.add("commerce.community-points");

  return new ExperienceRuntimeController(manifest, {
    compatibility: {
      engineApiVersion: EXPERIENCE_ENGINE_API_VERSION,
      experienceApiVersion: EXPERIENCE_API_VERSION,
      capabilities,
    },
    canAccess: options.canAccess,
    playSessionReporter: options.reporter,
    rendererRegistry,
    ...(options.randomSeed ? { randomSeed: options.randomSeed } : {}),
  });
}
