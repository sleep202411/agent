import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import {
  EXPERIENCE_API_VERSION,
  EXPERIENCE_ENGINE_API_VERSION,
  EXPERIENCE_ENGINE_BUILT_IN_CAPABILITIES,
  ExperienceRendererRegistry,
  ExperienceRuntimeController,
  type ExperienceRendererAdapter,
  type ExperienceRuntimeRestoreInput,
} from "@repo/experience-engine";

export interface ExperienceRuntimeOptions {
  rendererAdapters: readonly ExperienceRendererAdapter[];
  additionalCapabilities?: ReadonlySet<string>;
  randomSeed?: string;
  restore?: ExperienceRuntimeRestoreInput;
}

/**
 * Capabilities implemented by the React host itself rather than by the
 * headless engine or a renderer adapter. Keep this list next to the host
 * composition boundary so compatibility checks describe what the mounted
 * player can actually execute.
 */
const EXPERIENCE_REACT_HOST_CAPABILITIES = new Set([
  "input.tap",
  "input.swipe",
  "renderer.content-transform",
]);

/** React host adapter around the shared headless experience controller. */
export function createExperienceRuntime(
  manifest: ExperienceRuntimeManifest,
  options: ExperienceRuntimeOptions
): ExperienceRuntimeController {
  const rendererRegistry = new ExperienceRendererRegistry();
  options.rendererAdapters.forEach((adapter) => rendererRegistry.register(adapter));
  const capabilities = new Set(EXPERIENCE_ENGINE_BUILT_IN_CAPABILITIES);
  rendererRegistry.capabilities().forEach((capability) => capabilities.add(capability));
  EXPERIENCE_REACT_HOST_CAPABILITIES.forEach((capability) => capabilities.add(capability));
  options.additionalCapabilities?.forEach((capability) => capabilities.add(capability));

  return new ExperienceRuntimeController(manifest, {
    compatibility: {
      engineApiVersion: EXPERIENCE_ENGINE_API_VERSION,
      experienceApiVersion: EXPERIENCE_API_VERSION,
      capabilities,
    },
    rendererRegistry,
    ...(options.randomSeed ? { randomSeed: options.randomSeed } : {}),
    ...(options.restore ? { restore: options.restore } : {}),
  });
}
