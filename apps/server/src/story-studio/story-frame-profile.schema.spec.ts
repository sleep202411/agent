import {
  CreateStoryProjectSchema,
  PatchStoryProjectSchema,
  frameContractMatchesStoryProfile,
} from './dto';
import { FilmClipSpecSchema, FilmSpecSchema } from './interactive-film.schema';
import { buildHuBaoVillaImportBundle } from './import/hu-bao-villa.builder';

describe('StoryProject frame profile contract', () => {
  it('requires one of the two production profiles at project creation', () => {
    const base = {
      format: 'interactive_film',
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

describe('interactive-film frame schemas', () => {
  it('accepts exact 16:9 and 9:16 FilmSpec dimensions', () => {
    const { filmSpec } = buildHuBaoVillaImportBundle();
    const portrait = structuredClone(filmSpec);
    portrait.frame = {
      ...portrait.frame,
      aspectRatio: '9:16',
      width: 1080,
      height: 1920,
    };

    expect(FilmSpecSchema.safeParse(filmSpec).success).toBe(true);
    expect(FilmSpecSchema.safeParse(portrait).success).toBe(true);
  });

  it('rejects FilmSpec dimensions that do not match the declared ratio', () => {
    const { filmSpec } = buildHuBaoVillaImportBundle();
    const invalid = structuredClone(filmSpec);
    invalid.frame.aspectRatio = '9:16';

    expect(FilmSpecSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts portrait FilmClip output and rejects mismatched output dimensions', () => {
    const clip = structuredClone(buildHuBaoVillaImportBundle().clipSpecs[0]);
    clip.outputContract = {
      ...clip.outputContract,
      aspectRatio: '9:16',
      width: 1080,
      height: 1920,
    };
    expect(FilmClipSpecSchema.safeParse(clip).success).toBe(true);

    clip.outputContract.width = 1920;
    expect(FilmClipSpecSchema.safeParse(clip).success).toBe(false);
  });
});
