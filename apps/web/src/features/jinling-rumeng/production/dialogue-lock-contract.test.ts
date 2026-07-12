import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseJinlingDialogueLock } from "./dialogue-lock-contract";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCK_PATH = path.join(HERE, "manifests/s01-dialogue-lock-v1.json");

async function loadLock() {
  return parseJinlingDialogueLock(JSON.parse(await readFile(LOCK_PATH, "utf8")));
}

test("loads the complete locked landscape dialogue contract", async () => {
  const lock = await loadLock();
  assert.equal(lock.status, "LOCKED");
  assert.equal(lock.lockVersion, "1.0.0");
  assert.equal(lock.playerVoice, "silent-choice-intent");
  assert.equal(lock.orientation, "landscape-only");
  assert.equal(lock.aspectRatio, "16:9");
  assert.equal(lock.speakers.length, 10);
  assert.equal(lock.lines.length, 107);
  assert.equal(lock.choices.length, 33);
  assert.ok(lock.lines.every((line) => line.aspectRatio === "16:9"));
  assert.ok(lock.choices.every((choice) => choice.spoken === false));
});

test("covers P00, all ten scenes and all five ending dialogue sets", async () => {
  const lock = await loadLock();
  const sceneIds = new Set(lock.lines.map((line) => line.sceneId));
  const expected = [
    "S01-P00",
    ...Array.from({ length: 10 }, (_, index) => `S01-SC${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 5 }, (_, index) => `S01-E0${index + 1}`),
  ];
  assert.deepEqual([...sceneIds].sort(), expected.sort());
});

test("keeps every voiced line attached to a known strategy and forbids legacy wording", async () => {
  const lock = await loadLock();
  const corpus = lock.lines.map((line) => line.text).join("\n");
  assert.equal(corpus.includes("沈家老夫人"), false);
  assert.equal(corpus.includes("{name}"), false);
  assert.ok(lock.lines.some((line) => line.audioStrategy === "seedaudio-vo"));
  assert.ok(lock.lines.some((line) => line.audioStrategy === "seedance-sync"));
});

test("rejects a choice that points at an unknown reaction dialogue", async () => {
  const lock = await loadLock();
  const broken = structuredClone(lock);
  broken.choices[0]!.reactionDialogueIds = ["S01-MISSING-DIALOGUE"];
  assert.throws(() => parseJinlingDialogueLock(broken), /Unknown reaction dialogue/);
});
