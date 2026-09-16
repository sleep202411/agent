import {
  ExperienceJsonValueSchema,
  ExperienceThemeConfigSchema,
  canonicalizeExperienceJson,
  type ExperienceRuntimeManifest,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";

export type ExperienceThemeLoader = (
  manifest: ExperienceRuntimeManifest,
  signal?: AbortSignal
) => Promise<ExperienceThemeConfig>;

/** Client-side theme boundary; immutable config assets are hash-verified before use. */
export async function loadExperienceTheme(
  manifest: ExperienceRuntimeManifest,
  signal?: AbortSignal
): Promise<ExperienceThemeConfig> {
  signal?.throwIfAborted();
  const asset = manifest.assets.find(
    (candidate) => candidate.assetId === manifest.theme.configAssetId
  );
  if (!asset || asset.kind !== "data" || asset.format !== "json") {
    throw new Error(`Theme ${manifest.theme.themeId} has no JSON configuration asset`);
  }
  const response = await fetch(asset.uri, { signal, cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Theme ${manifest.theme.themeId} could not be loaded (${response.status})`);
  }
  const input: unknown = await response.json();
  signal?.throwIfAborted();
  const json = ExperienceJsonValueSchema.parse(input);
  const digest = await sha256(canonicalizeExperienceJson(json));
  signal?.throwIfAborted();
  if (digest !== asset.sha256) {
    throw new Error(`Theme ${manifest.theme.themeId} failed integrity validation`);
  }
  return ExperienceThemeConfigSchema.parse(json);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
