import { availableCrewAssetName } from './asset-name';

describe('Crew asset duplicate names', () => {
  it('keeps a unique original name intact', () => {
    expect(availableCrewAssetName('镜头 🎬.mp4', new Set())).toBe(
      '镜头 🎬.mp4',
    );
  });

  it('preserves the extension and skips names already used, ignoring case', () => {
    expect(
      availableCrewAssetName(
        'Scene.MP4',
        new Set(['scene.mp4', 'scene (2).mp4']),
      ),
    ).toBe('Scene (3).MP4');
  });

  it('does not split a surrogate pair when truncating a duplicate file stem', () => {
    const stem = 'a'.repeat(247);
    const original = `${stem}🎬.mp4`;
    const name = availableCrewAssetName(
      original,
      new Set([original.toLowerCase()]),
    );
    expect(name).toBe(`${stem} (2).mp4`);
    expect(name.length).toBeLessThanOrEqual(256);
    expect(Buffer.from(name, 'utf8').toString('utf8')).toBe(name);
  });

  it('keeps whole supplementary characters that fit the remaining space', () => {
    const original = `${'a'.repeat(246)}🎬.mp4`;
    expect(availableCrewAssetName(original, new Set([original]))).toBe(
      `${'a'.repeat(246)}🎬 (2).mp4`,
    );
  });

  it('allocates long duplicate folder names without malformed Unicode', () => {
    const original = `${'a'.repeat(251)}🎬`;
    const name = availableCrewAssetName(original, new Set([original]));
    expect(name).toBe(`${'a'.repeat(251)} (2)`);
    expect(Buffer.from(name, 'utf8').toString('utf8')).toBe(name);
  });
});
