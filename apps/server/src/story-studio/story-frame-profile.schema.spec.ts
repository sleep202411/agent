import {
  CreateStoryProjectSchema,
  PatchStoryProjectSchema,
  frameContractMatchesStoryProfile,
} from './dto';

describe('StoryProject frame profile contract', () => {
  it('requires one of the two production profiles for interactive film', () => {
    const base = {
      title: 'Portrait mystery',
      defaultLocale: 'en-US',
    } as const;

    expect(
      CreateStoryProjectSchema.parse({
        ...base,
        frameProfile: 'landscape_16_9',
      }).frameProfile,
    ).toBe('landscape_16_9');
    expect(
      CreateStoryProjectSchema.parse({
        ...base,
        frameProfile: 'portrait_9_16',
      }).frameProfile,
    ).toBe('portrait_9_16');
    // A film project fails loud when the frame contract is missing.
    expect(CreateStoryProjectSchema.safeParse(base).success).toBe(false);
    expect(
      CreateStoryProjectSchema.safeParse({
        ...base,
        frameProfile: 'square_1_1',
      }).success,
    ).toBe(false);
  });

  it('does not expose frameProfile through mutable project metadata', () => {
    expect(
      PatchStoryProjectSchema.safeParse({
        expectedProjectVersion: 0,
        frameProfile: 'portrait_9_16',
      }).success,
    ).toBe(false);
  });

  it('maps profiles to their exact project-wide output contract', () => {
    expect(
      frameContractMatchesStoryProfile('landscape_16_9', {
        aspectRatio: '16:9',
        width: 1920,
        height: 1080,
      }),
    ).toBe(true);
    expect(
      frameContractMatchesStoryProfile('portrait_9_16', {
        aspectRatio: '9:16',
        width: 1080,
        height: 1920,
      }),
    ).toBe(true);
    expect(
      frameContractMatchesStoryProfile('portrait_9_16', {
        aspectRatio: '16:9',
        width: 1920,
        height: 1080,
      }),
    ).toBe(false);
  });
});
