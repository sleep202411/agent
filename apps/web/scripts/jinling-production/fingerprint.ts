import { createHash } from "node:crypto";
import type {
  JinlingAssetManifest,
  ManifestAsset,
} from "../../src/features/jinling-rumeng/production/asset-manifest";

export const SEEDREAM_RUNNER_CONTRACT_VERSION = 3 as const;
export const SEEDANCE_RUNNER_CONTRACT_VERSION = 1 as const;

export interface ReferenceDigest {
  assetId: string;
  role: string;
  sha256: string;
  bytes: number;
  format: "png" | "jpg" | "webp";
  absolutePath: string;
}

export interface SeedreamRequestDescriptor {
  contractVersion: typeof SEEDREAM_RUNNER_CONTRACT_VERSION;
  manifest: {
    schemaVersion: number;
    manifestId: string;
    releaseId: string;
    contentVersion: string;
    sceneId: string;
    promptVersion: string;
  };
  assetId: string;
  provider: "byteplus-modelark";
  model: string;
  endpointId: string;
  mode: "text-to-image" | "reference-edit";
  orchestration: {
    route: "fizzdragon-cloud-job";
    publicBaseUrl: "https://studio.fizzdragon.com";
    catalogModelId: "seedream-5-pro";
    schemaVersion: string;
    imageSize: "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
    resolution: "1K" | "2K";
    sourceSurface: "jinling-production";
  };
  prompt: string;
  request: {
    size: string;
    outputFormat: "png" | "jpeg";
    responseFormat: "url";
    watermark: false;
  };
  reviewDerivation: {
    purpose: "review-only";
    method: "lanczos3";
    sourceDimensions: { width: number; height: number };
    targetDimensions: { width: number; height: number };
  } | null;
  references: Array<{
    assetId: string;
    role: string;
    sha256: string;
    bytes: number;
    format: "png" | "jpg" | "webp";
  }>;
}

type SeedreamAsset = ManifestAsset & {
  source: Extract<ManifestAsset["source"], { strategy: "seedream" }>;
  delivery: Extract<ManifestAsset["delivery"], { type: "image" }>;
};

export type SeedanceAsset = ManifestAsset & {
  source: Extract<ManifestAsset["source"], { strategy: "seedance" }>;
  delivery: Extract<ManifestAsset["delivery"], { type: "video" }>;
};

export interface SeedanceRequestDescriptor {
  contractVersion: typeof SEEDANCE_RUNNER_CONTRACT_VERSION;
  manifest: {
    schemaVersion: number;
    manifestId: string;
    releaseId: string;
    contentVersion: string;
    sceneId: string;
    promptVersion: string;
  };
  assetId: string;
  provider: "byteplus-modelark";
  model: "seedance-2.0";
  endpointId: string;
  mode: SeedanceAsset["source"]["mode"];
  prompt: string;
  request: SeedanceAsset["source"]["generationParams"];
  delivery: {
    width: number;
    height: number;
    frameCount: number;
    framesPerSecond: { numerator: number; denominator: number };
    codec: "h264" | "h265";
    audio: boolean;
  };
  references: Array<{
    assetId: string;
    role: string;
    sha256: string;
    bytes: number;
    format: "png" | "jpg" | "webp";
  }>;
}

export function isSeedreamImageAsset(asset: ManifestAsset): asset is SeedreamAsset {
  return asset.source.strategy === "seedream" && asset.delivery.type === "image";
}

export function isSeedanceVideoAsset(asset: ManifestAsset): asset is SeedanceAsset {
  return asset.source.strategy === "seedance" && asset.delivery.type === "video";
}

export function composeSeedreamPrompt(asset: SeedreamAsset): string {
  if (!asset.prompt) return "";

  const sections = [asset.prompt.positive.trim()];
  if (asset.prompt.script?.trim()) {
    sections.push(`Shot intent:\n${asset.prompt.script.trim()}`);
  }
  sections.push(
    `Hard negative constraints:\n${asset.prompt.negative
      .map((constraint) => `- ${constraint.trim()}`)
      .join("\n")}`
  );
  return sections.join("\n\n");
}

export function composeSeedancePrompt(asset: SeedanceAsset): string {
  if (!asset.prompt) return "";
  const sections = [asset.prompt.positive.trim()];
  if (asset.prompt.script?.trim()) {
    sections.push(`Shot timeline:\n${asset.prompt.script.trim()}`);
  }
  sections.push(
    `Hard negative constraints:\n${asset.prompt.negative
      .map((constraint) => `- ${constraint.trim()}`)
      .join("\n")}`
  );
  return sections.join("\n\n");
}

export function buildSeedanceRequestDescriptor(
  manifest: JinlingAssetManifest,
  asset: SeedanceAsset,
  references: readonly ReferenceDigest[]
): SeedanceRequestDescriptor {
  return {
    contractVersion: SEEDANCE_RUNNER_CONTRACT_VERSION,
    manifest: {
      schemaVersion: manifest.schemaVersion,
      manifestId: manifest.manifestId,
      releaseId: manifest.releaseId,
      contentVersion: manifest.contentVersion,
      sceneId: manifest.sceneId,
      promptVersion: manifest.promptVersion,
    },
    assetId: asset.assetId,
    provider: "byteplus-modelark",
    model: asset.source.model,
    endpointId: asset.source.endpointId,
    mode: asset.source.mode,
    prompt: composeSeedancePrompt(asset),
    request: asset.source.generationParams,
    delivery: {
      width: asset.delivery.width,
      height: asset.delivery.height,
      frameCount: asset.delivery.frameCount,
      framesPerSecond: asset.delivery.framesPerSecond,
      codec: asset.delivery.videoCodec,
      audio: asset.delivery.audio,
    },
    references: references.map((reference) => ({
      assetId: reference.assetId,
      role: reference.role,
      sha256: reference.sha256,
      bytes: reference.bytes,
      format: reference.format,
    })),
  };
}

export function buildSeedreamRequestDescriptor(
  manifest: JinlingAssetManifest,
  asset: SeedreamAsset,
  references: readonly ReferenceDigest[]
): SeedreamRequestDescriptor {
  return {
    contractVersion: SEEDREAM_RUNNER_CONTRACT_VERSION,
    manifest: {
      schemaVersion: manifest.schemaVersion,
      manifestId: manifest.manifestId,
      releaseId: manifest.releaseId,
      contentVersion: manifest.contentVersion,
      sceneId: manifest.sceneId,
      promptVersion: manifest.promptVersion,
    },
    assetId: asset.assetId,
    provider: "byteplus-modelark",
    model: asset.source.model,
    endpointId: asset.source.endpointId,
    mode: asset.source.mode,
    orchestration: {
      route: asset.source.orchestration.route,
      publicBaseUrl: asset.source.orchestration.publicBaseUrl,
      catalogModelId: asset.source.orchestration.catalogModelId,
      schemaVersion: asset.source.orchestration.schemaVersion,
      imageSize: asset.source.orchestration.imageSize,
      resolution: asset.source.orchestration.resolution,
      sourceSurface: asset.source.orchestration.sourceSurface,
    },
    prompt: composeSeedreamPrompt(asset),
    request: {
      size: asset.source.generationParams.size,
      outputFormat: asset.source.generationParams.outputFormat,
      responseFormat: "url",
      watermark: false,
    },
    reviewDerivation: asset.source.generationParams.derivation ?? null,
    references: references.map((reference) => ({
      assetId: reference.assetId,
      role: reference.role,
      sha256: reference.sha256,
      bytes: reference.bytes,
      format: reference.format,
    })),
  };
}

export function fingerprintDescriptor(
  descriptor: SeedreamRequestDescriptor | SeedanceRequestDescriptor
): string {
  return createHash("sha256").update(canonicalJson(descriptor)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Canonical JSON rejects ${typeof value}`);
}
