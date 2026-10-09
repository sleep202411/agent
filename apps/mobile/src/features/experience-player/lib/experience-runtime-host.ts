import {
  EXPERIENCE_CORE_VIDEO_STILL_CAPABILITY,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import {
  EXPERIENCE_API_VERSION,
  EXPERIENCE_ENGINE_API_VERSION,
  EXPERIENCE_ENGINE_BUILT_IN_CAPABILITIES,
  ExperienceRendererRegistry,
  ExperienceRuntimeController,
  type ExperienceRendererAdapter,
  type ExperienceAccessCheck,
} from "@repo/experience-engine";

export interface ExperienceRuntimeOptions {
  rendererAdapters: readonly ExperienceRendererAdapter[];
  additionalCapabilities?: ReadonlySet<string>;
  randomSeed?: string;
  canAccess?: ExperienceAccessCheck;
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
  options.rendererAdapters.forEach((adapter) => rendererRegistry.register(adapter));
  const capabilities = new Set(EXPERIENCE_ENGINE_BUILT_IN_CAPABILITIES);
  rendererRegistry.capabilities().forEach((capability) => capabilities.add(capability));
  EXPERIENCE_NATIVE_HOST_CAPABILITIES.forEach((capability) => capabilities.add(capability));
  if (options.canAccess) capabilities.add("commerce.community-points");
  options.additionalCapabilities?.forEach((capability) => capabilities.add(capability));

  return new ExperienceRuntimeController(manifest, {
    compatibility: {
      engineApiVersion: EXPERIENCE_ENGINE_API_VERSION,
      experienceApiVersion: EXPERIENCE_API_VERSION,
      capabilities,
    },
    canAccess: options.canAccess,
    rendererRegistry,
    ...(options.randomSeed ? { randomSeed: options.randomSeed } : {}),
  });
}
