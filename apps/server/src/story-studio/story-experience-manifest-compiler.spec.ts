import {
  InteractiveFilmReleaseSchema,
  type InteractiveFilmRelease,
} from '@repo/shared/interactive-film-runtime';
import {
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  ExperienceRuntimeManifestSchema,
} from '@repo/shared/experience-runtime';
import {
  compileStoryExperienceManifest,
  STORY_CORE_THEME_CONFIG_ASSET_ID,
} from './story-experience-manifest-compiler';

const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const BUILD_ID = '0197f4a2-0800-7000-8000-000000000004';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000006';
const VARIANT_ID = '0197f4a2-0800-7000-8000-000000000007';
const CHECKSUM = 'a'.repeat(64);
const COVER_ASSET_ID = '0197f4a2-0800-7000-8000-00000000000a';
const COVER_RUNTIME_ASSET_ID = `image:${COVER_ASSET_ID}`;
const COVER_VARIANT_ID = `${COVER_RUNTIME_ASSET_ID}:original`;
const COVER_CHECKSUM = 'b'.repeat(64);
const COVER_URL = `https://media.example.com/workspace/image/${COVER_ASSET_ID}.jpg`;

/** The release's cover as a plain-reference image asset. */
function coverMedia(): InteractiveFilmRelease['media'][number] {
  return {
    assetId: COVER_RUNTIME_ASSET_ID,
    kind: 'image',
    orientationPolicy: 'single-master',
    variants: {
      landscape: {
        sourceAssetId: COVER_ASSET_ID,
        sha256: COVER_CHECKSUM,
        src: COVER_URL,
        width: 1600,
        height: 900,
      },
    },
  };
}

function release(): InteractiveFilmRelease {
  return InteractiveFilmReleaseSchema.parse({
    schemaVersion: 1,
    channel: 'production',
    gameId: PROJECT_ID,
    releaseId: BUILD_ID,
    contentVersion: BUILD_ID,
    entryNodeId: 'clip.start',
    defaultLocale: 'en-US',
    locales: ['en-US'],
    media: [
      {
        assetId: 'video:START',
        kind: 'video',
        orientationPolicy: 'single-master',
        variants: {
          landscape: {
            sourceAssetId: ASSET_ID,
            sha256: CHECKSUM,
            src: `/aurora/story-projects/${PROJECT_ID}/builds/${BUILD_ID}/assets/${ASSET_ID}/variants/${VARIANT_ID}/content`,
            width: 1920,
            height: 1080,
            durationSeconds: 7,
          },
        },
      },
    ],
    nodes: [
      {
        nodeId: 'clip.start',
        presentation: {
          kind: 'video',
          sequence: [
            {
              clipId: 'clip.start',
              assetId: 'video:START',
              endBehavior: { behavior: 'advance' },
            },
          ],
          fit: 'cover',
        },
        overlays: [],
        exit: {
          kind: 'choice',
          decisionId: 'decision.path',
          prompt: { 'en-US': 'Choose.' },
          choices: [
            {
              choiceId: 'choose.truth',
              label: { 'en-US': 'Truth' },
              nextNodeId: 'clip.truth',
            },
            {
              choiceId: 'choose.echo',
              label: { 'en-US': 'Echo' },
              nextNodeId: 'clip.echo',
            },
          ],
        },
      },
      {
        nodeId: 'clip.truth',
        presentation: {
          kind: 'video',
          sequence: [
            {
              clipId: 'clip.truth',
              assetId: 'video:START',
              endBehavior: { behavior: 'advance' },
            },
          ],
          fit: 'cover',
        },
        overlays: [],
        exit: { kind: 'auto', nextNodeId: null },
      },
      {
        nodeId: 'clip.echo',
        presentation: {
          kind: 'video',
          sequence: [
            {
              clipId: 'clip.echo',
              assetId: 'video:START',
              endBehavior: { behavior: 'advance' },
            },
          ],
          fit: 'cover',
        },
        overlays: [],
        exit: { kind: 'auto', nextNodeId: null },
      },
    ],
  });
}

function compile(value = release()) {
  return compileStoryExperienceManifest({
    release: value,
    experienceProfile: 'cinematic',
    metadata: { title: 'Story', summary: 'A branching story.' },
    mediaIdentities: [
      {
        runtimeAssetId: 'video:START',
        variantId: VARIANT_ID,
        mediaType: 'video/mp4',
      },
    ],
  });
}

describe('Story Runtime Manifest v2 compiler', () => {
  it('is deterministic and preserves raw UUID release identity', () => {
    const first = compile();
    const second = compile();

    expect(first.diagnostics).toEqual([]);
    expect(first.manifest).toEqual(second.manifest);
    expect(
      ExperienceRuntimeManifestSchema.safeParse(first.manifest).success,
    ).toBe(true);
    expect(first.manifest).toMatchObject({
      manifestType: 'fizzdragon.experience',
      schemaVersion: 2,
      channel: 'production',
      gameId: PROJECT_ID,
      buildId: BUILD_ID,
      contentVersion: BUILD_ID,
    });
  });

  it('freezes the exact media variant and core theme identities', () => {
    const result = compile();
    const video = result.manifest?.assets.find(
      (asset) => asset.assetId === 'video:START',
    );
    if (!video || video.kind !== 'video') {
      throw new Error('Compiled video asset is missing.');
    }

    expect(video.variants[0]).toMatchObject({
      sourceAssetId: ASSET_ID,
      sha256: CHECKSUM,
      mediaType: 'video/mp4',
    });
    expect(video.variants[0]?.variantId).toContain(VARIANT_ID);
    expect(result.manifest?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: STORY_CORE_THEME_CONFIG_ASSET_ID,
          kind: 'data',
        }),
      ]),
    );
  });

  it('lowers choice semantics to core renderers', () => {
    const result = compile();
    const rendererIds = result.manifest?.rendererRequirements.map(
      (requirement) => requirement.rendererId,
    );

    expect(rendererIds).toEqual(
      expect.arrayContaining([
        EXPERIENCE_CORE_VIDEO_RENDERER_ID,
        EXPERIENCE_CORE_CHOICE_RENDERER_ID,
      ]),
    );
    expect(
      result.manifest?.graph.nodes.some((node) =>
        node.eventBindings.some((binding) =>
          binding.routes.some((route) =>
            route.actions.some((action) => action.kind === 'scene.goto'),
          ),
        ),
      ),
    ).toBe(true);
  });

  /**
   * The cover has to arrive as BOTH a resolvable image asset and the metadata
   * pointer, because the manifest schema validates the pointer against `assets`.
   * Asserting the metadata field alone would pass while the player still painted
   * a black rectangle.
   */
  it('emits the cover as a resolvable image asset and the metadata pointer', () => {
    const withCover = release();
    withCover.media.push(coverMedia());

    const result = compileStoryExperienceManifest({
      release: withCover,
      experienceProfile: 'cinematic',
      metadata: {
        title: 'Story',
        summary: null,
        coverAssetId: COVER_RUNTIME_ASSET_ID,
      },
      mediaIdentities: [
        {
          runtimeAssetId: 'video:START',
          variantId: VARIANT_ID,
          mediaType: 'video/mp4',
        },
        {
          runtimeAssetId: COVER_RUNTIME_ASSET_ID,
          variantId: COVER_VARIANT_ID,
          mediaType: 'image/jpeg',
        },
      ],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest?.metadata.coverAssetId).toBe(COVER_RUNTIME_ASSET_ID);
    const cover = result.manifest?.assets.find(
      (asset) => asset.assetId === COVER_RUNTIME_ASSET_ID,
    );
    if (!cover || cover.kind !== 'image') {
      throw new Error('Compiled cover image asset is missing.');
    }
    expect(cover.orientationPolicy).toBe('single-master');
    expect(cover.variants).toEqual([
      {
        variantId: COVER_VARIANT_ID,
        sourceAssetId: COVER_ASSET_ID,
        sha256: COVER_CHECKSUM,
        // A plain public media URL, not a frozen /aurora build-asset path.
        uri: COVER_URL,
        mediaType: 'image/jpeg',
        orientation: 'landscape',
        width: 1600,
        height: 900,
      },
    ]);
    // The manifest must satisfy its own contract, including the reference check
    // that makes a dangling coverAssetId invalid.
    expect(
      ExperienceRuntimeManifestSchema.safeParse(result.manifest).success,
    ).toBe(true);
  });

  /**
   * Proves the pairing above is load-bearing rather than decorative: the pointer
   * on its own does not produce a manifest at all.
   */
  it('refuses a cover pointer that resolves to no asset', () => {
    const result = compileStoryExperienceManifest({
      release: release(),
      experienceProfile: 'cinematic',
      metadata: {
        title: 'Story',
        summary: null,
        coverAssetId: COVER_RUNTIME_ASSET_ID,
      },
      mediaIdentities: [
        {
          runtimeAssetId: 'video:START',
          variantId: VARIANT_ID,
          mediaType: 'video/mp4',
        },
      ],
    });

    expect(result.manifest).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_EXPERIENCE_MANIFEST_SCHEMA_INVALID',
          path: ['metadata', 'coverAssetId'],
        }),
      ]),
    );
  });

  it('keeps a story with no cover free of any cover key', () => {
    const result = compile();

    expect(result.manifest?.metadata).not.toHaveProperty('coverAssetId');
    expect(
      result.manifest?.assets.some((asset) => asset.kind === 'image'),
    ).toBe(false);
  });

  it('fails when a runtime asset has no exact frozen variant identity', () => {
    const result = compileStoryExperienceManifest({
      release: release(),
      experienceProfile: 'cinematic',
      metadata: { title: 'Story', summary: null },
      mediaIdentities: [],
    });

    expect(result.manifest).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_EXPERIENCE_MEDIA_IDENTITY_MISSING',
        }),
      ]),
    );
  });
});
