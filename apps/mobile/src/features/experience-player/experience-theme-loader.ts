import {
  ExperienceJsonValueSchema,
  ExperienceThemeConfigSchema,
  canonicalizeExperienceJson,
  type ExperienceRuntimeManifest,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";

import { resolveAssetUrl, webBaseUrl } from "@/config";

export type ExperienceThemeLoader = (
  manifest: ExperienceRuntimeManifest,
  signal?: AbortSignal
) => Promise<ExperienceThemeConfig>;

/** Client-side theme boundary; immutable config assets are hash-verified before use. */
export async function loadExperienceTheme(
  manifest: ExperienceRuntimeManifest,
  signal?: AbortSignal
): Promise<ExperienceThemeConfig> {
  const asset = manifest.assets.find(
    (candidate) => candidate.assetId === manifest.theme.configAssetId
  );
  if (!asset || asset.kind !== "data" || asset.format !== "json") {
    throw new Error(`Theme ${manifest.theme.themeId} has no JSON configuration asset`);
  }
  const uri = absolutizeThemeUri(asset.uri);
  const response = await fetch(uri, { signal });
  if (!response.ok) {
    throw new Error(`Theme ${manifest.theme.themeId} could not be loaded (${response.status})`);
  }
  const input: unknown = await response.json();
  const json = ExperienceJsonValueSchema.parse(input);
  const digest = await sha256(canonicalizeExperienceJson(json));
  if (digest !== asset.sha256) {
    throw new Error(`Theme ${manifest.theme.themeId} failed integrity validation`);
  }
  return ExperienceThemeConfigSchema.parse(json);
}

function absolutizeThemeUri(uri: string): string {
  if (/^https?:\/\//i.test(uri)) return uri;
  if (uri.startsWith("//")) return `https:${uri}`;
  if (uri.startsWith("/")) return resolveAssetUrl(uri, webBaseUrl);
  return uri;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
