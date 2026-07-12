import assert from "node:assert/strict";
import test from "node:test";
import manifestSource from "./manifests/s01-p00-v01.json";
import { parseJinlingAssetManifest } from "./asset-manifest";
import { S01_P00_ASSET_MANIFEST } from "./p00-asset-manifest";

type MutableAsset = {
  assetId: string;
  taskId: string;
  kind: string;
  status: string;
  dependsOn: string[];
  source: Record<string, unknown>;
  submission: { state: string; blockers: string[] };
  delivery: Record<string, unknown>;
  output: { publicPath: string; recordPath: string };
};

type MutableManifest = {
  status: string;
  taskIds: string[];
  assets: MutableAsset[];
};

const cloneManifest = (): MutableManifest =>
  structuredClone(manifestSource) as unknown as MutableManifest;

function mutableAsset(manifest: MutableManifest, assetId: string): MutableAsset {
  const asset = manifest.assets.find((candidate) => candidate.assetId === assetId);
  assert.ok(asset, `Missing fixture asset ${assetId}`);
  return asset;
}

test("parses the machine-readable P00 manifest with canonical tasks and controlled media trials", () => {
  assert.equal(S01_P00_ASSET_MANIFEST.status, "DRAFT");
  assert.equal(S01_P00_ASSET_MANIFEST.contentVersion, "2026.07.11.landscape-only.1");
  assert.equal(S01_P00_ASSET_MANIFEST.promptVersion, "p00-video-first-v03");
  assert.deepEqual(S01_P00_ASSET_MANIFEST.taskIds, [
    "S01-P00-B02-VIDEO-OPENING",
    "S01-P00-B03-VIDEO-CONFIRM",
    "S01-P00-B03-VIDEO-TRANSITION",
  ]);

  const trials = S01_P00_ASSET_MANIFEST.assets.filter(
    (asset) => asset.submission.state === "REFERENCE_TRIAL"
  );
  assert.deepEqual(
    trials.map((asset) => asset.assetId),
    ["S01-P00-B02-IMG-MATTE-TAIXU-16X9", "S01-P00-B02-VIDEO-OPENING", "S01-P00-B03-VIDEO-CONFIRM"]
  );
  assert.ok(trials.every((asset) => asset.status === "REVIEW"));
  const matteTrials = trials.filter((asset) => asset.source.strategy === "seedream");
  const videoTrials = trials.filter((asset) => asset.source.strategy === "seedance");
  assert.equal(matteTrials.length, 1);
  assert.equal(videoTrials.length, 2);
  assert.ok(matteTrials.every((asset) => asset.purpose.includes("Seedream 5 Pro")));
  assert.ok(
    matteTrials.every(
      (asset) =>
        asset.acceptance.some((criterion) =>
          criterion.includes("evaluates composition, spatial layering and lighting only")
        ) &&
        asset.acceptance.some((criterion) => criterion.includes("Pro UNKNOWN transport outcome"))
    )
  );
  assert.equal(
    S01_P00_ASSET_MANIFEST.assets.filter((asset) => asset.submission.state !== "REFERENCE_TRIAL")
      .length,
    3
  );
  assert.ok(
    S01_P00_ASSET_MANIFEST.assets
      .filter((asset) => asset.submission.state !== "REFERENCE_TRIAL")
      .every(
        (asset) =>
          ["DRAFT", "LOCKED", "REVIEW"].includes(asset.status) &&
          asset.submission.state === "BLOCKED"
      )
  );
});

test("locks the official Seedream Pro trial identifiers and server-only ModelArk env names", () => {
  const mattes = S01_P00_ASSET_MANIFEST.assets.filter(
    (asset) => asset.source.strategy === "seedream"
  );
  assert.equal(mattes.length, 1);
  for (const matte of mattes) {
    assert.equal(matte.source.strategy, "seedream");
    if (matte.source.strategy !== "seedream") continue;
    assert.equal(matte.source.model, "seedream-5-pro");
    assert.equal(matte.source.providerModelId, "seedream-5-0-pro-260628");
    assert.equal(matte.source.endpointId, "dola-seedream-5-0-pro-260628");
    assert.equal(matte.source.enabledEnv, "BYTEPLUS_MODELARK_ENABLED");
    assert.equal(matte.source.credentialEnv, "BYTEPLUS_MODELARK_API_KEY");
    assert.equal(matte.source.baseUrlEnv, "BYTEPLUS_MODELARK_API_BASE_URL");
    assert.equal(matte.source.orchestration.route, "fizzdragon-cloud-job");
    assert.equal(matte.source.orchestration.publicBaseUrl, "https://studio.fizzdragon.com");
    assert.equal(matte.source.orchestration.authEnv, "FIZZDRAGON_SATOKEN");
    assert.equal(matte.source.orchestration.workspaceEnv, "FIZZDRAGON_WORKSPACE_ID");
    assert.equal(matte.source.orchestration.catalogModelId, "seedream-5-pro");
    assert.equal(matte.source.orchestration.schemaVersion, "2026-06-08");
    assert.equal(matte.source.orchestration.resolution, "2K");
    assert.equal(matte.source.orchestration.sourceSurface, "jinling-production");
    assert.equal(matte.source.generationParams.requestSizeMode, "exact-pixels");
    assert.equal(matte.source.generationParams.resolutionTier, "2K");
    assert.equal(matte.source.generationParams.outputFormat, "png");
    assert.equal(matte.source.generationParams.outputRole, "reference-trial");
    assert.equal(matte.source.generationParams.watermark, false);
    assert.ok(matte.delivery.type === "image");
    const expectedRequest =
      matte.assetId === "S01-P00-B02-IMG-MATTE-TAIXU-16X9"
        ? { width: 2816, height: 1584, size: "2816x1584" }
        : { width: 1584, height: 2816, size: "1584x2816" };
    assert.equal(matte.source.generationParams.width, expectedRequest.width);
    assert.equal(matte.source.generationParams.height, expectedRequest.height);
    assert.equal(
      matte.source.generationParams.width * matte.source.generationParams.height,
      4_460_544
    );
    assert.equal(matte.source.generationParams.size, expectedRequest.size);
    const derivation = matte.source.generationParams.derivation;
    assert.ok(derivation);
    assert.equal(derivation.purpose, "review-only");
    assert.equal(derivation.method, "lanczos3");
    assert.equal(
      `${derivation.sourceDimensions.width}x${derivation.sourceDimensions.height}`,
      expectedRequest.size
    );
    assert.equal(
      `${derivation.targetDimensions.width}x${derivation.targetDimensions.height}`,
      `${matte.delivery.width}x${matte.delivery.height}`
    );
  }

  const invalidEndpoint = cloneManifest();
  mutableAsset(invalidEndpoint, "S01-P00-B02-IMG-MATTE-TAIXU-16X9").source.endpointId =
    "seedream-5-0-lite-260128";
  assert.throws(
    () => parseJinlingAssetManifest(invalidEndpoint),
    /seedream-5-pro must use reviewed endpoint dola-seedream-5-0-pro-260628/
  );

  const invalidProviderModel = cloneManifest();
  mutableAsset(invalidProviderModel, "S01-P00-B02-IMG-MATTE-TAIXU-16X9").source.providerModelId =
    "seedream-5-0-lite-260128";
  assert.throws(
    () => parseJinlingAssetManifest(invalidProviderModel),
    /official model-list id seedream-5-0-pro-260628/
  );
});

test("enforces the official Seedream Pro exact-pixel and request-field contract", () => {
  const nonMultiple = cloneManifest();
  const nonMultipleParams = mutableAsset(nonMultiple, "S01-P00-B02-IMG-MATTE-TAIXU-16X9").source
    .generationParams as Record<string, unknown>;
  nonMultipleParams.width = 2817;
  nonMultipleParams.size = "2817x1584";
  (nonMultipleParams.derivation as { sourceDimensions: { width: number } }).sourceDimensions.width =
    2817;
  assert.throws(
    () => parseJinlingAssetManifest(nonMultiple),
    /exact dimensions must be multiples of 16/
  );

  const tooManyPixels = cloneManifest();
  const oversizedParams = mutableAsset(tooManyPixels, "S01-P00-B02-IMG-MATTE-TAIXU-16X9").source
    .generationParams as Record<string, unknown>;
  oversizedParams.width = 3072;
  oversizedParams.height = 1728;
  oversizedParams.size = "3072x1728";
  const oversizedSource = (
    oversizedParams.derivation as {
      sourceDimensions: { width: number; height: number };
    }
  ).sourceDimensions;
  oversizedSource.width = 3072;
  oversizedSource.height = 1728;
  assert.throws(() => parseJinlingAssetManifest(tooManyPixels), /921,600–4,624,220 pixels/);

  const invalidTier = cloneManifest();
  const invalidTierParams = mutableAsset(invalidTier, "S01-P00-B02-IMG-MATTE-TAIXU-16X9").source
    .generationParams as Record<string, unknown>;
  invalidTierParams.resolutionTier = "3K";
  assert.throws(() => parseJinlingAssetManifest(invalidTier), /1K|2K/);

  const unsupportedControls = cloneManifest();
  const unsupportedParams = mutableAsset(unsupportedControls, "S01-P00-B02-IMG-MATTE-TAIXU-16X9")
    .source.generationParams as Record<string, unknown>;
  unsupportedParams.stream = false;
  unsupportedParams.sequentialImageGeneration = "disabled";
  assert.throws(
    () => parseJinlingAssetManifest(unsupportedControls),
    /Unrecognized key|stream|sequentialImageGeneration/
  );

  const mismatchedFormat = cloneManifest();
  const mismatchedFormatParams = mutableAsset(mismatchedFormat, "S01-P00-B02-IMG-MATTE-TAIXU-16X9")
    .source.generationParams as Record<string, unknown>;
  mismatchedFormatParams.outputFormat = "jpeg";
  assert.throws(
    () => parseJinlingAssetManifest(mismatchedFormat),
    /output format must match the declared image delivery/i
  );
});

test("publishes only the locked 16:9 Jinling matte delivery", () => {
  const wide = S01_P00_ASSET_MANIFEST.assets.find(
    (asset) => asset.assetId === "S01-P00-B02-IMG-MATTE-TAIXU-16X9"
  );
  assert.ok(wide?.delivery.type === "image");
  assert.deepEqual(
    [wide.delivery.width, wide.delivery.height, wide.delivery.aspectRatio],
    [3840, 2160, "16:9"]
  );
  assert.ok(
    S01_P00_ASSET_MANIFEST.assets.every(
      (asset) => !("aspectRatio" in asset.delivery) || asset.delivery.aspectRatio !== "9:16"
    )
  );

  const invalidAspect = cloneManifest();
  mutableAsset(invalidAspect, "S01-P00-B02-IMG-MATTE-TAIXU-16X9").delivery.width = 2500;
  assert.throws(() => parseJinlingAssetManifest(invalidAspect), /does not match 16:9/);

  const invalidRequestSize = cloneManifest();
  const source = mutableAsset(invalidRequestSize, "S01-P00-B02-IMG-MATTE-TAIXU-16X9").source;
  const generationParams = source.generationParams as Record<string, unknown>;
  generationParams.size = "1920x1080";
  assert.throws(
    () => parseJinlingAssetManifest(invalidRequestSize),
    /exact-pixel size must match its request dimensions/i
  );

  const missingDerivation = cloneManifest();
  const missingDerivationParams = mutableAsset(
    missingDerivation,
    "S01-P00-B02-IMG-MATTE-TAIXU-16X9"
  ).source.generationParams as Record<string, unknown>;
  delete missingDerivationParams.derivation;
  assert.throws(
    () => parseJinlingAssetManifest(missingDerivation),
    /differing formal delivery requires an explicit derivation/i
  );
});

test("requires exact 168-frame transition masters and 288-frame opening trials at 24 fps", () => {
  const transitions = S01_P00_ASSET_MANIFEST.assets.filter((asset) =>
    asset.assetId.includes("B03-VIDEO-TRANSITION")
  );
  assert.equal(transitions.length, 1);
  for (const transition of transitions) {
    assert.ok(transition.delivery.type === "video");
    assert.equal(transition.delivery.framesPerSecond.numerator, 24);
    assert.equal(transition.delivery.framesPerSecond.denominator, 1);
    assert.equal(transition.delivery.frameCount, 168);
    assert.deepEqual(transition.delivery.durationSeconds, { min: 7, max: 7 });
    assert.equal(transition.delivery.audio, false);
    assert.equal(transition.source.strategy, "seedance");
    if (transition.source.strategy === "seedance") {
      assert.equal(transition.source.generationParams.resolution, "1080p");
      assert.equal(transition.source.generationParams.generateAudio, false);
    }
    assert.ok(!transition.dependsOn.includes("S01-P00-B02-MODEL-LEDGER"));
  }

  const openings = S01_P00_ASSET_MANIFEST.assets.filter((asset) =>
    asset.assetId.includes("B02-VIDEO-OPENING")
  );
  assert.equal(openings.length, 1);
  for (const opening of openings) {
    assert.ok(opening.delivery.type === "video");
    assert.equal(opening.delivery.frameCount, 288);
    assert.deepEqual(opening.delivery.durationSeconds, { min: 12, max: 12 });
    assert.equal(opening.source.strategy, "seedance");
    if (opening.source.strategy === "seedance") {
      assert.equal(opening.source.endpointId, "ep-20260708234913-w8kjv");
      assert.equal(opening.source.mode, "multimodal-to-video");
      assert.equal(opening.source.generationParams.outputRole, "reference-trial");
    }
  }

  const invalidFrames = cloneManifest();
  mutableAsset(invalidFrames, "S01-P00-B03-VIDEO-TRANSITION").delivery.frameCount = 167;
  assert.throws(
    () => parseJinlingAssetManifest(invalidFrames),
    /Frame count 167 falls outside the declared duration range/
  );
});

test("locks CONFIRM to exact opening hold frames and 144-frame image-to-video trials", () => {
  const continuity = S01_P00_ASSET_MANIFEST.assets.filter((asset) =>
    asset.assetId.includes("IMG-CONFIRM-FIRST")
  );
  assert.equal(continuity.length, 1);
  assert.ok(continuity.every((asset) => asset.status === "LOCKED"));
  assert.deepEqual(
    continuity.map((asset) => asset.output.publicPath),
    ["/jinling-rumeng/production/p00/continuity/opening-hold-16x9-v01.png"]
  );

  const confirmations = S01_P00_ASSET_MANIFEST.assets.filter((asset) =>
    asset.assetId.includes("B03-VIDEO-CONFIRM")
  );
  assert.equal(confirmations.length, 1);
  for (const confirmation of confirmations) {
    assert.equal(confirmation.source.strategy, "seedance");
    assert.ok(confirmation.delivery.type === "video");
    if (confirmation.source.strategy !== "seedance" || confirmation.delivery.type !== "video") {
      continue;
    }
    assert.equal(confirmation.source.mode, "image-to-video");
    assert.equal(confirmation.source.generationParams.durationSeconds, 6);
    assert.equal(confirmation.delivery.frameCount, 144);
    assert.deepEqual(confirmation.delivery.durationSeconds, { min: 6, max: 6 });
    assert.equal(confirmation.delivery.audio, false);
    assert.equal(confirmation.prompt?.referenceAssetIds.length, 1);
    assert.equal(confirmation.dependsOn.length, 1);
    assert.equal(confirmation.dependsOn[0], confirmation.prompt?.referenceAssetIds[0]);
  }
});

test("requires two ordered references for a first-last-frame Seedance request", () => {
  const invalid = cloneManifest();
  mutableAsset(invalid, "S01-P00-B02-VIDEO-OPENING").source.mode = "first-last-frame-to-video";
  assert.throws(
    () => parseJinlingAssetManifest(invalid),
    /requires exactly two ordered references/
  );
});

test("accepts the canonical seal as a TEXTURE with controlled SVG delivery", () => {
  const seal = S01_P00_ASSET_MANIFEST.assets.find(
    (asset) => asset.assetId === "S01-P00-B03-TEXTURE-SEAL-MASK"
  );
  assert.equal(seal?.kind, "TEXTURE");
  assert.deepEqual(seal?.delivery, { type: "data", format: "svg" });
  assert.equal(seal?.output.publicPath, "/jinling-rumeng/production/p00/seal/seal-mask-v01.svg");
  assert.equal(
    seal?.references[0]?.path,
    "docs/jinling-rumeng/visual/reference/VISUAL-DIRECTION-01-WATER-REALISM.png"
  );
});

test("keeps superseded realtime ledger assets out of the active video manifest", () => {
  const obsoleteIds = new Set([
    "S01-P00-B02-DATA-LEDGER-ORTHOGRAPHIC",
    "S01-P00-B02-DATA-LEDGER-STRUCTURE",
    "S01-P00-B02-MODEL-LEDGER",
  ]);
  assert.ok(S01_P00_ASSET_MANIFEST.assets.every((asset) => !obsoleteIds.has(asset.assetId)));
  assert.ok(
    S01_P00_ASSET_MANIFEST.assets.every((asset) =>
      asset.references.every((reference) => reference.assetId !== "PROP-LEDGER-REF-V01")
    )
  );
});

test("rejects duplicate asset ids and unknown task assignments", () => {
  const duplicate = cloneManifest();
  duplicate.assets[1].assetId = duplicate.assets[0].assetId;
  assert.throws(() => parseJinlingAssetManifest(duplicate), /Duplicate asset id/);

  const unknownTask = cloneManifest();
  unknownTask.assets[0].taskId = "S01-P00-B99-MISSING-TASK";
  assert.throws(() => parseJinlingAssetManifest(unknownTask), /Unknown production task/);
});

test("rejects missing and cyclic dependencies", () => {
  const missing = cloneManifest();
  mutableAsset(missing, "S01-P00-B03-VIDEO-TRANSITION").dependsOn.push(
    "S01-P00-B03-MISSING-FIRST-FRAME"
  );
  assert.throws(() => parseJinlingAssetManifest(missing), /Unknown dependency/);

  const cyclic = cloneManifest();
  mutableAsset(cyclic, "S01-P00-B02-IMG-MATTE-TAIXU-16X9").dependsOn.push(
    "S01-P00-B03-VIDEO-TRANSITION"
  );
  assert.throws(() => parseJinlingAssetManifest(cyclic), /dependency graph contains a cycle/i);
});

test("does not allow a DRAFT manifest to expose a formally submittable asset", () => {
  const invalid = cloneManifest();
  const seal = mutableAsset(invalid, "S01-P00-B03-TEXTURE-SEAL-MASK");
  seal.status = "LOCKED";
  seal.submission = { state: "FORMAL_READY", blockers: [] };
  assert.throws(
    () => parseJinlingAssetManifest(invalid),
    /draft manifest cannot contain formally submittable assets/i
  );

  const derivedTrial = cloneManifest();
  const matte = mutableAsset(derivedTrial, "S01-P00-B02-IMG-MATTE-TAIXU-16X9");
  matte.status = "LOCKED";
  matte.submission = { state: "FORMAL_READY", blockers: [] };
  assert.throws(
    () => parseJinlingAssetManifest(derivedTrial),
    /review-only derivation cannot be treated as FORMAL_READY/i
  );
});
