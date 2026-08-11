import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

import {
  ExperienceJsonValueSchema,
  ExperienceThemeConfigSchema,
  canonicalizeExperienceJson,
  type ExperienceRuntimeManifest,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";

import { resolveExperienceAssetUrl } from "@/config";

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
  const uri = resolveExperienceAssetUrl(asset.uri);
  const response = await fetch(uri, { signal });
  if (!response.ok) {
    throw new Error(`Theme ${manifest.theme.themeId} could not be loaded (${response.status})`);
  }
  const input: unknown = await response.json();
  const json = ExperienceJsonValueSchema.parse(input);
  // Hermes has no WebCrypto, so this cannot use `crypto.subtle` like the web
  // player does. @noble/hashes is pure JS — no native module, no rebuild.
  const digest = bytesToHex(sha256(canonicalizeExperienceJson(json)));
  if (digest !== asset.sha256) {
    throw new Error(`Theme ${manifest.theme.themeId} failed integrity validation`);
  }
  return ExperienceThemeConfigSchema.parse(json);
}
