#!/usr/bin/env -S npx tsx

import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadRunnerEnvironment } from "./environment";
import { RunnerError } from "./errors";
import {
  buildSeedanceRequestDescriptor,
  fingerprintDescriptor,
  type ReferenceDigest,
} from "./fingerprint";
import { resolveFizzdragonCloudConfig } from "./fizzdragon-cloud";
import { runFizzdragonSeedanceTrial } from "./fizzdragon-seedance-cloud";
import { inspectLocalReferenceImage } from "./image-file";
import {
  loadProductionManifest,
  type LoadedProductionManifest,
  type LoadedSeedanceAsset,
} from "./manifest-loader";
import { DEFAULT_WORK_ROOT, REPO_ROOT, WEB_ROOT } from "./paths";
import {
  JINLING_FILM_CONTINUITY_V3,
  JINLING_FILM_EDIT_BRIDGES_V3,
} from "../../src/features/jinling-rumeng/production/s01-film-cut-v2";

const MANIFEST_PATH = path.join(
  WEB_ROOT,
  "src/features/jinling-rumeng/production/manifests/s01-film-cut-v2.json"
);
const MAX_OUTPUT_BYTES = 96 * 1024 * 1024;
const MAX_CONTINUITY_FRAME_BYTES = 30 * 1024 * 1024;
// Calibrated against reviewed generated-frame pairs: identical compositions can
// fall to ~0.58 from codec and micro-texture regeneration; reviewed true reframes were <0.33.
const MIN_DIRECT_SEAM_SSIM = 0.5;
const execFileAsync = promisify(execFile);

type BatchResult = {
  assetId: string;
  status: "generated" | "existing" | "failed";
  outputPath?: string;
  jobId?: string;
  message?: string;
  haltBatch?: boolean;
};

async function main(): Promise<void> {
  const concurrency = parseConcurrency(process.argv.slice(2));
  const maxNew = parseMaxNew(process.argv.slice(2));
  const loaded = await loadProductionManifest(MANIFEST_PATH, REPO_ROOT);
  const environment = await loadRunnerEnvironment(REPO_ROOT);
  const cloudConfig = resolveFizzdragonCloudConfig(environment);
  const queue = [...loaded.seedanceAssets];
  const results: BatchResult[] = [];

  process.stdout.write(
    `${JSON.stringify({ event: "batch-start", assets: queue.length, concurrency, maxNew })}\n`
  );

  let nextIndex = 0;
  let attemptedNew = 0;
  const workers = Array.from({ length: concurrency }, async (_, workerIndex) => {
    while (nextIndex < queue.length) {
      const index = nextIndex;
      nextIndex += 1;
      const selected = queue[index]!;
      const result = await produceOne(loaded, selected, cloudConfig, workerIndex + 1);
      results[index] = result;
      process.stdout.write(`${JSON.stringify({ event: "asset-finished", ...result })}\n`);
      if (result.status !== "existing") attemptedNew += 1;
      if (result.haltBatch || attemptedNew >= maxNew) break;
    }
  });

  await Promise.all(workers);
  const summary = {
    event: "batch-finished",
    generated: results.filter((item) => item.status === "generated").length,
    existing: results.filter((item) => item.status === "existing").length,
    failed: results.filter((item) => item.status === "failed").length,
    failures: results.filter((item) => item.status === "failed"),
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.failed > 0) process.exitCode = 1;
}

function parseMaxNew(args: string[]): number {
  const index = args.indexOf("--max-new");
  if (index === -1) return Number.POSITIVE_INFINITY;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 39) {
    throw new Error("--max-new must be an integer from 1 to 39");
  }
  return value;
}

async function produceOne(
  loaded: LoadedProductionManifest,
  selected: LoadedSeedanceAsset,
  cloudConfig: ReturnType<typeof resolveFizzdragonCloudConfig>,
  worker: number
): Promise<BatchResult> {
  try {
    const continuitySelected = await withContinuityReference(loaded, selected);
    const destination = destinationFor(continuitySelected);
    const recordPath = recordPathFor(continuitySelected);
    if (
      (await isRegularFile(destination)) &&
      (await recordMatchesFingerprint(recordPath, continuitySelected.fingerprint))
    ) {
      return {
        assetId: continuitySelected.asset.assetId,
        status: "existing",
        outputPath: destination,
      };
    }

    process.stdout.write(
      `${JSON.stringify({
        event: "asset-start",
        worker,
        assetId: continuitySelected.asset.assetId,
        continuityReference:
          continuitySelected.references[0]?.role === "mandatory exact predecessor tail frame",
      })}\n`
    );

    const result = await runFizzdragonSeedanceTrial({
      loaded,
      selected: continuitySelected,
      confirmedFingerprint: continuitySelected.fingerprint,
      config: cloudConfig,
      workRoot: DEFAULT_WORK_ROOT,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    });
    const seamSsim = await verifyContinuitySeam(continuitySelected, result.sourcePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await installMasterAtomically(path.resolve(REPO_ROOT, result.sourcePath), destination);

    await mkdir(path.dirname(recordPath), { recursive: true });
    await writeFile(
      recordPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          assetId: continuitySelected.asset.assetId,
          fingerprint: continuitySelected.fingerprint,
          jobId: result.jobId,
          referenceMediaAssetIds: result.referenceMediaAssetIds,
          sha256: result.sha256,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          framesPerSecond: result.framesPerSecond,
          frameCount: result.frameCount,
          durationSeconds: result.durationSeconds,
          audioStreamCount: result.audioStreamCount,
          continuityPredecessor:
            JINLING_FILM_CONTINUITY_V3[requiredShotId(continuitySelected)]?.predecessorId ?? null,
          continuityTailSha256:
            continuitySelected.references[0]?.role === "mandatory exact predecessor tail frame"
              ? continuitySelected.references[0].sha256
              : null,
          continuitySeamSsim: seamSsim,
          continuityEditBridge:
            JINLING_FILM_EDIT_BRIDGES_V3[requiredShotId(continuitySelected)] ?? null,
          outputPath: continuitySelected.asset.output.publicPath,
          reviewed: false,
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    return {
      assetId: continuitySelected.asset.assetId,
      status: "generated",
      outputPath: destination,
      jobId: result.jobId,
    };
  } catch (error) {
    const haltBatch = isInsufficientComputePoints(error) || isContinuityRejection(error);
    const detail =
      error instanceof RunnerError && error.details ? ` ${JSON.stringify(error.details)}` : "";
    return {
      assetId: selected.asset.assetId,
      status: "failed",
      message: error instanceof Error ? `${error.message}${detail}` : "unknown production failure",
      ...(haltBatch ? { haltBatch: true } : {}),
    };
  }
}

function isContinuityRejection(error: unknown): boolean {
  return error instanceof RunnerError && error.details?.continuitySeam === true;
}

function isInsufficientComputePoints(error: unknown): boolean {
  return (
    error instanceof RunnerError &&
    typeof error.details?.providerMessage === "string" &&
    error.details.providerMessage.includes("Not enough compute points")
  );
}

async function installMasterAtomically(source: string, destination: string): Promise<void> {
  const part = `${destination}.${process.pid}.part`;
  await rm(part, { force: true });
  await copyFile(source, part);
  await rename(part, destination);
}

async function withContinuityReference(
  loaded: LoadedProductionManifest,
  selected: LoadedSeedanceAsset
): Promise<LoadedSeedanceAsset> {
  const shotId = requiredShotId(selected);
  const rule = JINLING_FILM_CONTINUITY_V3[shotId];
  if (!rule) return selected;

  const predecessor = loaded.seedanceAssets.find(
    (candidate) => candidate.asset.shotId === rule.predecessorId
  );
  if (!predecessor) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Continuity predecessor ${rule.predecessorId} is missing for ${selected.asset.shotId}.`
    );
  }
  const predecessorVideo = destinationFor(predecessor);
  const predecessorShotId = requiredShotId(predecessor);
  if (!(await isRegularFile(predecessorVideo))) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Continuity predecessor video is not ready for ${selected.asset.shotId}.`
    );
  }

  const tailDirectory = path.join(DEFAULT_WORK_ROOT, "film-cut-continuity", "tail-frames");
  const tailPath = path.join(tailDirectory, `${predecessorShotId.toLowerCase()}.png`);
  await mkdir(tailDirectory, { recursive: true });
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-sseof",
    "-0.042",
    "-i",
    predecessorVideo,
    "-frames:v",
    "1",
    "-vf",
    `scale=${predecessor.asset.delivery.width}:${predecessor.asset.delivery.height}:flags=lanczos`,
    tailPath,
  ]);
  const inspected = await inspectLocalReferenceImage(tailPath, MAX_CONTINUITY_FRAME_BYTES);
  const continuityReference: ReferenceDigest = {
    assetId: `${selected.asset.assetId}-CONTINUITY-FIRST-FRAME`,
    role: "mandatory exact predecessor tail frame",
    absolutePath: tailPath,
    sha256: inspected.sha256,
    bytes: inspected.bytes,
    format: inspected.format,
  };
  const continuityInstruction =
    rule.join === "direct"
      ? "The first reference image is the mandatory frame-zero composition. Begin on that exact image and continue the existing camera motion, actor movement, lighting, sound perspective and performance without any visible cut or reset."
      : "The first reference image is the mandatory frame-zero composition. Begin on that exact image and carry its existing foreground occlusion or darkness across the stitch, then reveal the next beat as one uninterrupted camera move.";
  const asset = structuredClone(selected.asset);
  const inheritedReferenceIds = rule.join === "direct" ? [] : asset.prompt!.referenceAssetIds;
  asset.prompt = {
    ...asset.prompt!,
    positive: `${continuityInstruction}\n\n${asset.prompt!.positive}`,
    referenceAssetIds: [continuityReference.assetId, ...inheritedReferenceIds],
  };
  const inheritedAssetReferences = rule.join === "direct" ? [] : asset.references;
  asset.references = [
    {
      assetId: continuityReference.assetId,
      path: path.relative(REPO_ROOT, tailPath),
      role: continuityReference.role,
    },
    ...inheritedAssetReferences,
  ];
  const references = [continuityReference, ...(rule.join === "direct" ? [] : selected.references)];
  const descriptor = buildSeedanceRequestDescriptor(loaded.manifest, asset, references);
  return {
    asset,
    references,
    descriptor,
    fingerprint: fingerprintDescriptor(descriptor),
  };
}

async function verifyContinuitySeam(
  selected: LoadedSeedanceAsset,
  repoRelativeSourcePath: string
): Promise<number | null> {
  const rule = JINLING_FILM_CONTINUITY_V3[requiredShotId(selected)];
  const continuityReference = selected.references[0];
  if (
    !rule ||
    rule.join !== "direct" ||
    continuityReference?.role !== "mandatory exact predecessor tail frame"
  ) {
    return null;
  }

  const headPath = path.join(
    DEFAULT_WORK_ROOT,
    "film-cut-continuity",
    "head-frames",
    `${requiredShotId(selected).toLowerCase()}.png`
  );
  await mkdir(path.dirname(headPath), { recursive: true });
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    path.resolve(REPO_ROOT, repoRelativeSourcePath),
    "-frames:v",
    "1",
    headPath,
  ]);
  const comparison = await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-i",
    continuityReference.absolutePath,
    "-i",
    headPath,
    "-lavfi",
    "ssim",
    "-f",
    "null",
    "-",
  ]);
  const match = comparison.stderr.match(/All:([0-9.]+)/);
  const ssim = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(ssim)) {
    throw new RunnerError("OUTPUT_INVALID", "Continuity seam SSIM could not be measured.", {
      continuitySeam: true,
    });
  }
  if (ssim < MIN_DIRECT_SEAM_SSIM && !JINLING_FILM_EDIT_BRIDGES_V3[requiredShotId(selected)]) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      "Generated segment failed the direct-continuity first-frame gate.",
      { continuitySeam: true, ssim }
    );
  }
  return ssim;
}

function requiredShotId(selected: LoadedSeedanceAsset): string {
  if (!selected.asset.shotId) {
    throw new RunnerError("ASSET_INVALID", `Video asset ${selected.asset.assetId} has no shot id.`);
  }
  return selected.asset.shotId;
}

function destinationFor(selected: LoadedSeedanceAsset): string {
  return path.join(WEB_ROOT, "public", selected.asset.output.publicPath.slice(1));
}

function recordPathFor(selected: LoadedSeedanceAsset): string {
  return path.join(REPO_ROOT, "docs/jinling-rumeng", selected.asset.output.recordPath);
}

async function recordMatchesFingerprint(filePath: string, fingerprint: string): Promise<boolean> {
  try {
    const record = JSON.parse(await readFile(filePath, "utf8")) as { fingerprint?: unknown };
    return record.fingerprint === fingerprint;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

function parseConcurrency(args: string[]): number {
  const index = args.indexOf("--concurrency");
  if (index === -1) return 1;
  const value = Number(args[index + 1]);
  if (value !== 1) {
    throw new Error("Continuity-chained production requires --concurrency 1");
  }
  return value;
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

void main();
