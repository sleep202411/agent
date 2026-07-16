import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { ExperienceRuntimeInvariantError } from "./runtime.js";

export const EXPERIENCE_ENGINE_API_VERSION = "2.0.0" as const;
export const EXPERIENCE_API_VERSION = "1.0.0" as const;

export const EXPERIENCE_ENGINE_BUILT_IN_CAPABILITIES = new Set([
  "input.press-hold",
  "spatial.anchor",
  "spatial.renderer-content",
  "spatial.keyframes",
  "audio.core",
  "audio.deterministic-selection",
]);

export interface ExperienceRuntimeHostCompatibility {
  engineApiVersion: string;
  experienceApiVersion: string;
  capabilities: ReadonlySet<string>;
}

export function assertExperienceRuntimeCompatibility(
  manifest: ExperienceRuntimeManifest,
  host: ExperienceRuntimeHostCompatibility
): void {
  if (manifest.compatibility.engineApiVersion !== host.engineApiVersion) {
    throw new ExperienceRuntimeInvariantError(
      "ENGINE_API_UNSUPPORTED",
      `Manifest requires engine API ${manifest.compatibility.engineApiVersion}; host provides ${host.engineApiVersion}`
    );
  }
  if (manifest.compatibility.experienceApiVersion !== host.experienceApiVersion) {
    throw new ExperienceRuntimeInvariantError(
      "EXPERIENCE_API_UNSUPPORTED",
      `Manifest requires Experience API ${manifest.compatibility.experienceApiVersion}; host provides ${host.experienceApiVersion}`
    );
  }
  const missing = manifest.compatibility.requiredCapabilities.filter(
    (capability) => !host.capabilities.has(capability)
  );
  if (missing.length > 0) {
    throw new ExperienceRuntimeInvariantError(
      "CAPABILITY_UNSUPPORTED",
      `Host is missing required capabilities: ${missing.join(", ")}`
    );
  }
}
