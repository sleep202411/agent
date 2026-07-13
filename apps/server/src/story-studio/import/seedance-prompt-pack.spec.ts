import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSeedancePromptPack } from './seedance-prompt-pack';

const promptPack = readFileSync(
  resolve(
    __dirname,
    '../../../../../docs/interactive-films/hu-bao-villa-longkou-night-seedance-prompt-pack-v1.md',
  ),
  'utf8',
);

describe('Seedance prompt-pack importer', () => {
  const clips = parseSeedancePromptPack(promptPack);

  it('parses all 21 production clips in stable rank order', () => {
    expect(clips).toHaveLength(21);
    expect(clips.map((clip) => clip.rank)).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 1),
    );
    expect(new Set(clips.map((clip) => clip.key)).size).toBe(21);
  });

  it('locks every provider clip to 15 seconds', () => {
    expect(new Set(clips.map((clip) => clip.durationMs))).toEqual(
      new Set([15_000]),
    );
  });

  it('keeps Omni and Frame inputs mutually exclusive', () => {
    const omni = clips.filter(
      (clip) => clip.generationControl.mode === 'omni_reference',
    );
    const frame = clips.filter(
      (clip) => clip.generationControl.mode === 'frame_lock',
    );
    expect(omni.map((clip) => clip.key)).toEqual([
      'hbln-s00-dragon-returns',
      'hbln-e01-name-returned',
      'hbln-e02-last-opening',
      'hbln-e03-exit-together',
    ]);
    expect(frame).toHaveLength(17);
    expect(frame.every((clip) => !clip.modelInput.includes('[Image '))).toBe(
      true,
    );
  });

  it('parses every display declaration into a logical reference-slot input', () => {
    const byKey = new Map(clips.map((clip) => [clip.key, clip]));

    expect(byKey.get('hbln-s01a-opening-march')?.modelInputs).toEqual([
      { kind: 'first_frame', position: 0, referenceSlotKey: 'S00-LAST' },
      { kind: 'last_frame', position: 0, referenceSlotKey: 'JF-01' },
    ]);
    expect(byKey.get('hbln-e04-seventh-gong')?.modelInputs).toEqual([
      { kind: 'first_frame', position: 0, referenceSlotKey: 'S00-FIRST' },
      {
        kind: 'last_frame',
        position: 0,
        referenceSlotKey: 'E04-PREBLACK-END',
      },
    ]);
    expect(
      clips.every(
        (clip) =>
          clip.modelInputs.length > 0 &&
          clip.modelInputs.every((input) => input.referenceSlotKey.length > 0),
      ),
    ).toBe(true);
  });

  it('parses a contiguous 0–15s timeline for every clip', () => {
    for (const clip of clips) {
      expect(clip.timeline[0].startMs).toBe(0);
      expect(clip.timeline.at(-1)?.endMs).toBe(15_000);
    }
  });
});
