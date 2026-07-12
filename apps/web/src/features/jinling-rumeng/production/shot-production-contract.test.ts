import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parseJinlingAssetManifest } from "./asset-manifest";
import { parseJinlingDialogueLock } from "./dialogue-lock-contract";
import { parseJinlingShotProductionPack } from "./shot-production-contract";

const productionRoot = path.resolve(process.cwd(), "src/features/jinling-rumeng/production");
const dialoguePath = path.join(productionRoot, "manifests/s01-dialogue-lock-v1.json");
const packPath = path.join(productionRoot, "manifests/s01-p00-sc01-production-v1.json");
const seedancePath = path.join(productionRoot, "manifests/s01-sc01-seedance-v1.json");

async function load() {
  const dialogueRaw = await readFile(dialoguePath);
  const [packRaw, seedanceRaw] = await Promise.all([readFile(packPath), readFile(seedancePath)]);
  return {
    dialogueRaw,
    dialogue: parseJinlingDialogueLock(JSON.parse(dialogueRaw.toString("utf8"))),
    pack: parseJinlingShotProductionPack(JSON.parse(packRaw.toString("utf8"))),
    seedance: parseJinlingAssetManifest(JSON.parse(seedanceRaw.toString("utf8"))),
  };
}

test("locks the P00 through SC02 production slice to the exact dialogue manifest", async () => {
  const { dialogueRaw, dialogue, pack } = await load();
  assert.equal(pack.dialogueManifestSha256, createHash("sha256").update(dialogueRaw).digest("hex"));
  assert.deepEqual(pack.scopeSceneIds, ["S01-P00", "S01-SC01", "S01-SC02"]);
  assert.equal(pack.orientation, "landscape-only");
  assert.equal(pack.aspectRatio, "16:9");
  assert.equal(pack.playerVoice, "silent-choice-intent");

  const scopedScenes = new Set<string>(pack.scopeSceneIds);
  const lockedSlice = dialogue.lines.filter((line) => scopedScenes.has(line.sceneId));
  const expectedAudio = lockedSlice
    .filter((line) => line.audioStrategy === "seedaudio-vo")
    .map((line) => line.dialogueId)
    .sort();
  const actualAudio = pack.audioTasks.flatMap((task) => task.dialogueIds).sort();
  assert.deepEqual(actualAudio, expectedAudio);

  const expectedSynced = lockedSlice
    .filter((line) => line.audioStrategy === "seedance-sync")
    .map((line) => line.dialogueId)
    .sort();
  const actualSynced = pack.videoTasks
    .filter((task) => task.generateAudio)
    .flatMap((task) => task.dialogueIds)
    .sort();
  assert.deepEqual(actualSynced, expectedSynced);
});

test("keeps every locked word, condition and performance direction unchanged", async () => {
  const { dialogue, pack } = await load();
  const lines = new Map(dialogue.lines.map((line) => [line.dialogueId, line]));
  for (const task of pack.audioTasks) {
    assert.equal(task.dialogueIds.length, 1);
    const line = lines.get(task.dialogueIds[0]!);
    assert.ok(line);
    assert.equal(task.text, line.text);
    assert.equal(task.performance, line.performance);
    assert.equal(task.condition, line.condition);
    assert.equal(task.speakerId, line.speakerId);
    assert.equal(task.targetDurationSeconds, line.targetDurationSeconds);
  }

  const daiyu = lines.get("S01-SC01-C01C-DY-01");
  const daiyuTask = pack.videoTasks.find((task) => task.generateAudio);
  assert.ok(daiyu);
  assert.ok(daiyuTask);
  assert.deepEqual(daiyuTask.dialogueIds, [daiyu.dialogueId]);
  assert.equal(daiyuTask.condition, daiyu.condition);
  assert.match(daiyuTask.prompt, new RegExp(daiyu.text));
});

test("requires the reviewed Daiyu portrait to pass virtual-portrait registration", async () => {
  const { pack } = await load();
  const portraitRefs = pack.references.filter((reference) => reference.requiresVirtualPortrait);
  assert.deepEqual(
    portraitRefs.map((reference) => reference.referenceId),
    ["S01-SC01-REF-DAIYU-IDENTITY"]
  );
  const syncedTask = pack.videoTasks.find((task) => task.generateAudio);
  assert.ok(syncedTask);
  assert.equal(syncedTask.mode, "multimodal-to-video");
  assert.ok(syncedTask.referenceIds.includes("S01-SC01-REF-DAIYU-IDENTITY"));
});

test("publishes four runnable 1080p landscape Seedance candidates without overwriting v1", async () => {
  const { seedance } = await load();
  assert.equal(seedance.status, "LOCKED");
  assert.equal(seedance.assets.length, 4);
  assert.equal(new Set(seedance.assets.map((asset) => asset.output.publicPath)).size, 4);
  for (const asset of seedance.assets) {
    assert.equal(asset.kind, "VIDEO");
    assert.equal(asset.source.strategy, "seedance");
    assert.equal(asset.source.generationParams.ratio, "16:9");
    assert.equal(asset.delivery.type, "video");
    assert.equal(asset.delivery.width, 1920);
    assert.equal(asset.delivery.height, 1080);
    assert.equal(asset.submission.state, "REFERENCE_TRIAL");
    assert.doesNotMatch(asset.output.publicPath, /sc01-main-16x9-v01\.mp4$/);
  }
  assert.equal(
    seedance.assets.filter(
      (asset) => asset.source.strategy === "seedance" && asset.source.generationParams.generateAudio
    ).length,
    1
  );
  const c01a = seedance.assets.find(
    (asset) => asset.assetId === "S01-SC01-C01A-VIDEO-REACT-CANDIDATE-V2"
  );
  assert.ok(c01a && c01a.source.strategy === "seedance");
  assert.ok(c01a.prompt);
  assert.equal(c01a.source.mode, "first-last-frame-to-video");
  assert.deepEqual(c01a.prompt.referenceAssetIds, [
    "S01-SC01-C01A-V2-FIRST",
    "S01-SC01-C01A-V2-LAST",
  ]);
});

test("contains no portrait production path or delivery", async () => {
  const { pack } = await load();
  for (const task of pack.videoTasks) {
    assert.equal(task.width / task.height, 16 / 9);
    assert.doesNotMatch(task.outputPath, /9x16|portrait/i);
  }
  for (const visual of pack.existingVisuals) {
    assert.doesNotMatch(visual.path, /9x16|portrait/i);
  }
});
