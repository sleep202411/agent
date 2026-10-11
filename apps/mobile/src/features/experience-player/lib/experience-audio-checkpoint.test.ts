import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { expect, it } from "vitest";

import { validateExperienceAudioCheckpoint } from "./experience-audio-checkpoint";

const manifest = {
  audio: { cues: [{ cueId: "music", assetIds: ["track"] }], buses: [{ busId: "master" }] },
} as unknown as ExperienceRuntimeManifest;
const saved = {
  playbacks: [
    { cueId: "music", assetId: "track", playbackRate: 1, playbackOrdinal: 2, positionSeconds: 15 },
  ],
  busGains: { master: 0.5 },
};
it("clones persisted positions, deterministic ordinals and bus gain", () => {
  const restored = validateExperienceAudioCheckpoint(manifest, saved)!;
  expect(restored).toEqual(saved);
  restored.playbacks[0]!.positionSeconds = 0;
  expect(saved.playbacks[0]!.positionSeconds).toBe(15);
  expect(validateExperienceAudioCheckpoint(manifest, undefined)).toBeUndefined();
});
it.each([
  { cueId: "removed" },
  { assetId: "replaced" },
  { playbackOrdinal: -1 },
  { playbackOrdinal: 1.5 },
  { positionSeconds: Infinity },
  { playbackRate: 0 },
])("rejects incompatible or corrupt audio state %j", (patch) => {
  expect(() =>
    validateExperienceAudioCheckpoint(manifest, {
      ...saved,
      playbacks: [{ ...saved.playbacks[0], ...patch }],
    })
  ).toThrow();
});
it("rejects duplicate playbacks and unknown or invalid buses", () => {
  expect(() =>
    validateExperienceAudioCheckpoint(manifest, {
      ...saved,
      playbacks: [...saved.playbacks, ...saved.playbacks],
    })
  ).toThrow();
  for (const busGains of [{ removed: 1 }, { master: -1 }, { master: NaN }]) {
    expect(() => validateExperienceAudioCheckpoint(manifest, { ...saved, busGains })).toThrow();
  }
});
