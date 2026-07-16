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

export interface WebExperienceRuntimeOptions {
  rendererAdapters: readonly ExperienceRendererAdapter[];
  additionalCapabilities?: ReadonlySet<string>;
  randomSeed?: string;
  restore?: ExperienceRuntimeRestoreInput;
}

/** Web player adapter around the same headless controller used by Studio. */
export function createWebExperienceRuntime(
  manifest: ExperienceRuntimeManifest,
  options: WebExperienceRuntimeOptions
): ExperienceRuntimeController {
  const rendererRegistry = new ExperienceRendererRegistry();
  options.rendererAdapters.forEach((adapter) => rendererRegistry.register(adapter));
  const capabilities = new Set(EXPERIENCE_ENGINE_BUILT_IN_CAPABILITIES);
  rendererRegistry.capabilities().forEach((capability) => capabilities.add(capability));
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
