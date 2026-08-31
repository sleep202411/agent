import { STORY_VISUAL_STYLE_SKILL_SLUGS } from '@repo/shared';
import {
  CreateStoryProjectSchema,
  PatchStoryProjectSchema,
  StoryDurationPresetSchema,
  StoryVisualStyleSchema,
  frameContractMatchesStoryProfile,
} from './dto';

describe('StoryProject frame profile contract', () => {
  it('creates the project before the Agent asks for its production profile', () => {
    const base = {
      title: 'Portrait mystery',
      defaultLocale: 'en-US',
    } as const;

    expect(CreateStoryProjectSchema.safeParse(base).success).toBe(true);
    expect(
      CreateStoryProjectSchema.safeParse({
        ...base,
        frameProfile: 'landscape_16_9',
      }).success,
    ).toBe(false);
  });

  it('allows frameProfile only through atomic creative-profile confirmation', () => {
    expect(
      PatchStoryProjectSchema.safeParse({
        expectedProjectVersion: 0,
        frameProfile: 'portrait_9_16',
      }).success,
    ).toBe(false);
    expect(
      PatchStoryProjectSchema.safeParse({
        expectedProjectVersion: 0,
        frameProfile: 'portrait_9_16',
        durationPreset: 'short_5_15',
        visualStyle: 'cinematic-realism',
        confirmCreativeProfile: true,
      }).success,
    ).toBe(true);
  });

  it('confirms duration and visual direction atomically without a silent default', () => {
    expect(StoryDurationPresetSchema.options).toEqual([
      'short_5_15',
      'medium_15_30',
      'long_30_60',
    ]);
    expect(StoryVisualStyleSchema.options).toEqual(
      STORY_VISUAL_STYLE_SKILL_SLUGS,
    );
    expect(
      PatchStoryProjectSchema.parse({
        expectedProjectVersion: 0,
        frameProfile: 'landscape_16_9',
        durationPreset: 'short_5_15',
        visualStyle: 'cinematic-realism',
        confirmCreativeProfile: true,
      }),
    ).toMatchObject({
      frameProfile: 'landscape_16_9',
      durationPreset: 'short_5_15',
      visualStyle: 'cinematic-realism',
      confirmCreativeProfile: true,
    });
    expect(
      PatchStoryProjectSchema.safeParse({
        expectedProjectVersion: 0,
        frameProfile: 'landscape_16_9',
        durationPreset: 'short_5_15',
      }).success,
    ).toBe(false);
    expect(
      PatchStoryProjectSchema.safeParse({
        expectedProjectVersion: 0,
        frameProfile: 'landscape_16_9',
        visualStyle: 'cinematic-realism',
        confirmCreativeProfile: true,
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
