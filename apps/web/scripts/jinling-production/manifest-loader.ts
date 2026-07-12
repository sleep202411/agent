import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  parseJinlingAssetManifest,
  type JinlingAssetManifest,
  type ManifestAsset,
} from "../../src/features/jinling-rumeng/production/asset-manifest";
import { RunnerError } from "./errors";
import { inspectLocalReferenceImage, type SupportedImageFormat } from "./image-file";
import {
  buildSeedreamRequestDescriptor,
  buildSeedanceRequestDescriptor,
  fingerprintDescriptor,
  isSeedreamImageAsset,
  isSeedanceVideoAsset,
  type ReferenceDigest,
  type SeedanceRequestDescriptor,
  type SeedreamRequestDescriptor,
} from "./fingerprint";

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_SEEDREAM_REFERENCE_BYTES = 30 * 1024 * 1024;
const MAX_SEEDANCE_REFERENCE_BYTES = 30 * 1024 * 1024;
const MIN_SEEDREAM_OUTPUT_PIXELS = 3_686_400;
const MAX_SEEDREAM_OUTPUT_PIXELS = 16_777_216;

export interface LoadedSeedreamAsset {
  asset: ManifestAsset & {
    source: Extract<ManifestAsset["source"], { strategy: "seedream" }>;
    delivery: Extract<ManifestAsset["delivery"], { type: "image" }>;
  };
  references: ReferenceDigest[];
  descriptor: SeedreamRequestDescriptor;
  fingerprint: string;
}

export interface LoadedProductionManifest {
  manifestPath: string;
  manifestSha256: string;
  manifest: JinlingAssetManifest;
  seedreamAssets: LoadedSeedreamAsset[];
  seedanceAssets: LoadedSeedanceAsset[];
}

export interface LoadedSeedanceAsset {
  asset: ManifestAsset & {
    source: Extract<ManifestAsset["source"], { strategy: "seedance" }>;
    delivery: Extract<ManifestAsset["delivery"], { type: "video" }>;
  };
  references: ReferenceDigest[];
  descriptor: SeedanceRequestDescriptor;
  fingerprint: string;
}

export async function loadProductionManifest(
  manifestPath: string,
  repoRoot: string
): Promise<LoadedProductionManifest> {
  const absoluteManifestPath = path.resolve(manifestPath);
  let raw: Buffer;
  try {
    const metadata = await stat(absoluteManifestPath);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_MANIFEST_BYTES) {
      throw new RunnerError(
        "MANIFEST_INVALID",
        `Manifest must be a regular JSON file no larger than ${MAX_MANIFEST_BYTES} bytes.`
      );
    }
    raw = await readFile(absoluteManifestPath);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new RunnerError(
        "MANIFEST_MISSING",
        `Production manifest is missing at ${absoluteManifestPath}.`
      );
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new RunnerError("MANIFEST_INVALID", "Production manifest is not valid JSON.");
  }

  let manifest: JinlingAssetManifest;
  try {
    manifest = parseJinlingAssetManifest(json);
  } catch (error) {
    throw new RunnerError("MANIFEST_INVALID", "Production manifest failed its schema.", {
      issueCount: zodIssueCount(error),
    });
  }
  await validateAllReferencePaths(manifest, repoRoot);

  const seedreamAssets: LoadedSeedreamAsset[] = [];
  const seedanceAssets: LoadedSeedanceAsset[] = [];
  for (const asset of manifest.assets) {
    validateOutputExtension(asset);
    if (isSeedreamImageAsset(asset)) {
      validateSeedreamManifestContract(asset);
      const references = await loadSeedreamReferenceDigests(asset, repoRoot);
      const descriptor = buildSeedreamRequestDescriptor(manifest, asset, references);
      seedreamAssets.push({
        asset,
        references,
        descriptor,
        fingerprint: fingerprintDescriptor(descriptor),
      });
    }
    if (isSeedanceVideoAsset(asset)) {
      validateSeedanceManifestContract(asset);
      const references = await loadSeedanceReferenceDigests(asset, repoRoot);
      const descriptor = buildSeedanceRequestDescriptor(manifest, asset, references);
      seedanceAssets.push({
        asset,
        references,
        descriptor,
        fingerprint: fingerprintDescriptor(descriptor),
      });
    }
  }

  return {
    manifestPath: absoluteManifestPath,
    manifestSha256: createHash("sha256").update(raw).digest("hex"),
    manifest,
    seedreamAssets,
    seedanceAssets,
  };
}

export function selectSeedreamAsset(
  loaded: LoadedProductionManifest,
  assetId: string
): LoadedSeedreamAsset {
  const selected = loaded.seedreamAssets.find((candidate) => candidate.asset.assetId === assetId);
  if (!selected) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Asset ${assetId} is missing or is not a Seedream image asset in this manifest.`
    );
  }
  return selected;
}

export function selectSeedanceAsset(
  loaded: LoadedProductionManifest,
  assetId: string
): LoadedSeedanceAsset {
  const selected = loaded.seedanceAssets.find((candidate) => candidate.asset.assetId === assetId);
  if (!selected) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Asset ${assetId} is missing or is not a Seedance video asset in this manifest.`
    );
  }
  return selected;
}

export function isReferenceTrialEligible(
  manifestStatus: JinlingAssetManifest["status"],
  asset: ManifestAsset
): boolean {
  return (
    manifestStatus !== "REJECTED" &&
    asset.status === "REVIEW" &&
    asset.submission.state === "REFERENCE_TRIAL" &&
    asset.submission.blockers.length === 0 &&
    asset.kind === "IMAGE" &&
    asset.source.strategy === "seedream" &&
    asset.source.generationParams.outputRole === "reference-trial" &&
    asset.source.generationParams.derivation?.purpose === "review-only" &&
    asset.source.generationParams.derivation.method === "lanczos3"
  );
}

export function isSeedanceReferenceTrialEligible(
  manifestStatus: JinlingAssetManifest["status"],
  asset: ManifestAsset
): boolean {
  return (
    manifestStatus !== "REJECTED" &&
    asset.status === "REVIEW" &&
    asset.submission.state === "REFERENCE_TRIAL" &&
    asset.submission.blockers.length === 0 &&
    asset.kind === "VIDEO" &&
    asset.source.strategy === "seedance" &&
    asset.source.generationParams.outputRole === "reference-trial"
  );
}

function validateSeedreamManifestContract(asset: LoadedSeedreamAsset["asset"]): void {
  if (!asset.prompt) {
    throw new RunnerError("ASSET_INVALID", `Seedream asset ${asset.assetId} has no prompt.`);
  }
  if (asset.source.credentialEnv !== "BYTEPLUS_MODELARK_API_KEY") {
    throw new RunnerError(
      "ASSET_INVALID",
      `Seedream asset ${asset.assetId} does not use the canonical credential environment name.`
    );
  }
  if (asset.source.baseUrlEnv && asset.source.baseUrlEnv !== "BYTEPLUS_MODELARK_API_BASE_URL") {
    throw new RunnerError(
      "ASSET_INVALID",
      `Seedream asset ${asset.assetId} does not use the canonical base URL environment name.`
    );
  }

  const promptReferenceIds = asset.prompt.referenceAssetIds;
  if (new Set(promptReferenceIds).size !== promptReferenceIds.length) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Seedream asset ${asset.assetId} repeats a prompt reference.`
    );
  }
  const referenceIds = new Set(asset.references.map((reference) => reference.assetId));
  for (const referenceId of promptReferenceIds) {
    if (!referenceIds.has(referenceId)) {
      throw new RunnerError(
        "ASSET_INVALID",
        `Seedream asset ${asset.assetId} has an unresolved prompt reference.`
      );
    }
  }
  if (asset.source.mode === "reference-edit" && promptReferenceIds.length === 0) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Seedream reference-edit asset ${asset.assetId} requires a prompt reference.`
    );
  }
  if (asset.source.mode === "text-to-image" && promptReferenceIds.length > 0) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Seedream text-to-image asset ${asset.assetId} cannot send reference images.`
    );
  }
  const outputPixels = asset.source.generationParams.width * asset.source.generationParams.height;
  if (
    !Number.isSafeInteger(outputPixels) ||
    outputPixels < MIN_SEEDREAM_OUTPUT_PIXELS ||
    outputPixels > MAX_SEEDREAM_OUTPUT_PIXELS
  ) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Seedream asset ${asset.assetId} exact pixel delivery is outside the reviewed ModelArk range.`
    );
  }
  if (asset.delivery.alpha) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Seedream asset ${asset.assetId} cannot require an unverified alpha channel.`
    );
  }
  if (
    asset.source.generationParams.outputRole === "reference-trial" &&
    asset.delivery.format !== "png"
  ) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Seedream reference trial ${asset.assetId} must derive a PNG review artifact.`
    );
  }
}

async function loadSeedreamReferenceDigests(
  asset: LoadedSeedreamAsset["asset"],
  repoRoot: string
): Promise<ReferenceDigest[]> {
  if (!asset.prompt) return [];
  const byId = new Map(asset.references.map((reference) => [reference.assetId, reference]));
  const references: ReferenceDigest[] = [];
  for (const assetId of asset.prompt.referenceAssetIds) {
    const reference = byId.get(assetId);
    if (!reference) {
      throw new RunnerError("ASSET_INVALID", `Reference ${assetId} is not mapped to a local path.`);
    }
    const absolutePath = await resolveRegularFileInsideRepo(reference.path, repoRoot);
    const inspected = await inspectLocalReferenceImage(absolutePath, MAX_SEEDREAM_REFERENCE_BYTES);
    references.push({
      assetId,
      role: reference.role,
      absolutePath,
      sha256: inspected.sha256,
      bytes: inspected.bytes,
      format: inspected.format,
    });
  }
  return references;
}

function validateSeedanceManifestContract(asset: LoadedSeedanceAsset["asset"]): void {
  if (!asset.prompt) {
    throw new RunnerError("ASSET_INVALID", `Seedance asset ${asset.assetId} has no prompt.`);
  }
  const promptReferenceIds = asset.prompt.referenceAssetIds;
  const referenceIds = new Set(asset.references.map((reference) => reference.assetId));
  for (const referenceId of promptReferenceIds) {
    if (!referenceIds.has(referenceId)) {
      throw new RunnerError(
        "ASSET_INVALID",
        `Seedance asset ${asset.assetId} has an unresolved prompt reference.`
      );
    }
  }
  if (asset.source.mode === "text-to-video" && promptReferenceIds.length > 0) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Seedance text-to-video asset ${asset.assetId} cannot send reference media.`
    );
  }
  if (asset.source.mode !== "text-to-video" && promptReferenceIds.length === 0) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Seedance ${asset.source.mode} asset ${asset.assetId} requires controlled media references.`
    );
  }
}

async function loadSeedanceReferenceDigests(
  asset: LoadedSeedanceAsset["asset"],
  repoRoot: string
): Promise<ReferenceDigest[]> {
  if (!asset.prompt) return [];
  const byId = new Map(asset.references.map((reference) => [reference.assetId, reference]));
  const references: ReferenceDigest[] = [];
  for (const assetId of asset.prompt.referenceAssetIds) {
    const reference = byId.get(assetId);
    if (!reference) {
      throw new RunnerError("ASSET_INVALID", `Reference ${assetId} is not mapped to a local path.`);
    }
    const absolutePath = reference.path.startsWith("/jinling-rumeng/production/")
      ? await resolveRegularFileInsideRepo(
          path.join("apps/web/public", reference.path.replace(/^\/+/, "")),
          repoRoot
        )
      : await resolveRegularFileInsideRepo(reference.path, repoRoot);
    const inspected = await inspectLocalReferenceImage(absolutePath, MAX_SEEDANCE_REFERENCE_BYTES);
    references.push({
      assetId,
      role: reference.role,
      absolutePath,
      sha256: inspected.sha256,
      bytes: inspected.bytes,
      format: inspected.format,
    });
  }
  return references;
}

async function validateAllReferencePaths(
  manifest: JinlingAssetManifest,
  repoRoot: string
): Promise<void> {
  const checked = new Set<string>();
  const declaredOutputs = new Set(manifest.assets.map((asset) => asset.output.publicPath));
  for (const asset of manifest.assets) {
    for (const reference of asset.references) {
      if (checked.has(reference.path)) continue;
      if (reference.path.startsWith("/jinling-rumeng/production/")) {
        if (!declaredOutputs.has(reference.path)) {
          throw new RunnerError(
            "ASSET_INVALID",
            `Runtime reference is not a declared manifest output: ${reference.path}`
          );
        }
        checked.add(reference.path);
        continue;
      }
      await resolveRegularFileInsideRepo(reference.path, repoRoot);
      checked.add(reference.path);
    }
  }
}

async function resolveRegularFileInsideRepo(
  referencePath: string,
  repoRoot: string
): Promise<string> {
  if (path.isAbsolute(referencePath)) {
    throw new RunnerError("SECURITY_REJECTED", "Manifest reference paths must be repo-relative.");
  }
  const lexicalPath = path.resolve(repoRoot, referencePath);
  if (!isWithin(repoRoot, lexicalPath)) {
    throw new RunnerError("SECURITY_REJECTED", "Manifest reference path escapes the repository.");
  }
  let resolved: string;
  try {
    resolved = await realpath(lexicalPath);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new RunnerError("ASSET_INVALID", `Reference file is missing: ${referencePath}`);
    }
    throw error;
  }
  if (!isWithin(await realpath(repoRoot), resolved)) {
    throw new RunnerError(
      "SECURITY_REJECTED",
      "Manifest reference symlink escapes the repository."
    );
  }
  return resolved;
}

function validateOutputExtension(asset: ManifestAsset): void {
  const extension = path.posix.extname(asset.output.publicPath).slice(1).toLowerCase();
  const expected = deliveryExtension(asset.delivery);
  if (extension !== expected) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Asset ${asset.assetId} output extension .${extension || "<none>"} does not match ${expected}.`
    );
  }
}

function deliveryExtension(delivery: ManifestAsset["delivery"]): string {
  switch (delivery.type) {
    case "image":
      return delivery.format;
    case "video":
      return delivery.container;
    case "audio":
      return delivery.format;
    case "model":
      return delivery.format;
    case "data":
      return delivery.format;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function zodIssueCount(error: unknown): number {
  if (!error || typeof error !== "object" || !("issues" in error)) return 1;
  const issues = (error as { issues?: unknown }).issues;
  return Array.isArray(issues) ? issues.length : 1;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export type { SupportedImageFormat };
