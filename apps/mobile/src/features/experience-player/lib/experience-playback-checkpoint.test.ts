import { describe, expect, it } from "vitest";
import { advanceExperienceTimeline, createExperienceTimelineCursor } from "@repo/experience-engine";
import type { ExperienceRuntimeManifest, ExperienceScene } from "@repo/shared/experience-runtime";
import {
  clampWatchedSeek,
  mediaPlaybackSignature,
  scenePlaybackSignature,
  shouldAdvancePlaybackTimeline,
  validateExperiencePlaybackCheckpoint,
  type ExperiencePlaybackCheckpoint,
} from "./experience-playback-checkpoint";

function fixture() {
  const scene = {
    kind: "scene",
    sceneId: "scene.one",
    clock: { kind: "renderer", rendererInstanceId: "video.one" },
    renderers: [
      {
        instanceId: "video.one",
        rendererId: "core.video",
        layer: 0,
        config: {
          fit: "cover",
          autoplay: true,
          sequence: [
            { clipId: "clip.one", assetId: "asset.one", endBehavior: { behavior: "advance" } },
          ],
        },
        bindings: {},
      },
    ],
    timeline: {
      cues: [
        { cueId: "cue.once", atMs: 2000, once: true },
        { cueId: "cue.repeat", atMs: 3000, once: false },
      ],
    },
    gestures: [],
    anchors: [],
    eventBindings: [],
  } as ExperienceScene;
  const manifest = {
    graph: { nodes: [scene] },
    assets: [
      {
        assetId: "asset.one",
        kind: "video",
        variants: [{ uri: "/one.mp4", sha256: "a".repeat(64) }],
      },
    ],
  } as unknown as ExperienceRuntimeManifest;
  const checkpoint: ExperiencePlaybackCheckpoint = {
    version: 1,
    sceneId: scene.sceneId,
    sceneSignature: scenePlaybackSignature(scene),
    sceneTimeMs: 4000,
    cursor: { sceneId: scene.sceneId, positionMs: 5000, firedOnceCueIds: ["cue.once"] },
    openRendererIds: [],
    settledGestureIds: [],
    parkedEvents: [],
    fixedClockEnded: false,
    playbackEnabled: true,
    rate: 1.5,
    media: [
      {
        rendererInstanceId: "video.one",
        sequenceIndex: 0,
        assetId: "asset.one",
        mediaSignature: mediaPlaybackSignature(manifest, "asset.one"),
        positionMs: 4000,
        watchedUntilMs: 5000,
        durationMs: 10000,
        isStill: false,
        terminalMode: null,
        remainingHoldMs: null,
        completed: false,
      },
    ],
  };
  return { manifest, scene, checkpoint };
}

describe("playback checkpoint compatibility", () => {
  it("keeps existing story saves without seconds checkpoints usable", () => {
    const { manifest } = fixture();
    expect(validateExperiencePlaybackCheckpoint(manifest, "scene.one", undefined)).toBeUndefined();
  });
  it("round trips paused replay position separately from the highest dispatched cue", () => {
    const { manifest, checkpoint } = fixture();
    const restored = validateExperiencePlaybackCheckpoint(
      manifest,
      "scene.one",
      JSON.parse(JSON.stringify(checkpoint))
    );
    expect(restored).toEqual(checkpoint);
    restored!.media[0]!.positionMs = 0;
    expect(checkpoint.media[0]!.positionMs).toBe(4000);
  });
  it("accepts a republish whose scene and media identities still match", () => {
    const { manifest, checkpoint } = fixture();
    expect(
      validateExperiencePlaybackCheckpoint(
        { ...manifest, contentVersion: "new-release" },
        "scene.one",
        checkpoint
      )
    ).toEqual(checkpoint);
  });
  it("rejects replaced footage, altered choices and cross-scene positions", () => {
    const { manifest, scene, checkpoint } = fixture();
    manifest.assets[0]!.assetId = "different";
    expect(() => validateExperiencePlaybackCheckpoint(manifest, "scene.one", checkpoint)).toThrow();
    const fresh = fixture();
    scene.timeline.cues.push({ cueId: "new-choice", atMs: 1000, once: true });
    expect(() =>
      validateExperiencePlaybackCheckpoint(
        { ...fresh.manifest, graph: { ...fresh.manifest.graph, nodes: [scene] } },
        "scene.one",
        checkpoint
      )
    ).toThrow();
    expect(() =>
      validateExperiencePlaybackCheckpoint(fresh.manifest, "scene.other", checkpoint)
    ).toThrow();
  });
  it.each([
    { sceneTimeMs: -1 },
    { rate: 9 },
    { settledGestureIds: ["unknown"] },
    { openRendererIds: ["unknown"] },
    { cursor: { sceneId: "other", positionMs: 5000, firedOnceCueIds: [] } },
    { parkedEvents: [{ type: "scene.goto", sourceId: "scene.other" }] },
  ])("rejects invalid persisted presentation %j", (patch) => {
    const { manifest, checkpoint } = fixture();
    expect(() =>
      validateExperiencePlaybackCheckpoint(manifest, "scene.one", { ...checkpoint, ...patch })
    ).toThrow();
  });
  it("rejects malformed sequence offsets and nonfinite positions", () => {
    const { manifest, checkpoint } = fixture();
    for (const patch of [
      { sequenceIndex: 8 },
      { positionMs: Infinity },
      { watchedUntilMs: 10001 },
      { terminalMode: { kind: "loop", assetId: "asset.one" } },
    ]) {
      expect(() =>
        validateExperiencePlaybackCheckpoint(manifest, "scene.one", {
          ...checkpoint,
          media: [{ ...checkpoint.media[0], ...patch }],
        })
      ).toThrow();
    }
  });
});

it("replays never repeat earlier timeline actions, including once:false cues", () => {
  const { scene } = fixture();
  const first = advanceExperienceTimeline(
    scene,
    createExperienceTimelineCursor(scene.sceneId),
    5000
  );
  expect(first.events).toHaveLength(2);
  for (const replayPosition of [0, 1000, 3000, 5000]) {
    expect(shouldAdvancePlaybackTimeline(first.cursor, replayPosition)).toBe(false);
  }
  expect(shouldAdvancePlaybackTimeline(first.cursor, 5100)).toBe(true);
  expect(advanceExperienceTimeline(scene, first.cursor, 5100).events).toEqual([]);
});

it("seek cannot credit unseen footage or pass duration and handles invalid input", () => {
  expect(clampWatchedSeek(90000, 60000, 12000)).toBe(12000);
  expect(clampWatchedSeek(-10000, 60000, 12000)).toBe(0);
  expect(clampWatchedSeek(10000, 8000, 12000)).toBe(8000);
  expect(clampWatchedSeek(NaN, 60000, 12000)).toBe(0);
});
