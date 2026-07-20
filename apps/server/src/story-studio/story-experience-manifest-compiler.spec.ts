import {
  InteractiveFilmReleaseSchema,
  type InteractiveFilmRelease,
} from '@repo/shared/interactive-film-runtime';
import {
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_TEXT_RENDERER_ID,
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
    endings: [
      {
        endingId: 'truth',
        title: { 'en-US': 'Truth' },
        summary: { 'en-US': 'Truth wins.' },
        kind: 'truth',
      },
      {
        endingId: 'echo',
        title: { 'en-US': 'Echo' },
        summary: { 'en-US': 'The moment echoes.' },
        kind: 'echo',
      },
    ],
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
        audio: 'embedded',
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
        exit: { kind: 'ending', endingId: 'truth' },
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
        exit: { kind: 'ending', endingId: 'echo' },
      },
    ],
  });
}

function textChoiceRelease(): InteractiveFilmRelease {
  return InteractiveFilmReleaseSchema.parse({
    schemaVersion: 1,
    channel: 'production',
    gameId: PROJECT_ID,
    releaseId: BUILD_ID,
    contentVersion: BUILD_ID,
    entryNodeId: 'text.start',
    defaultLocale: 'en-US',
    locales: ['en-US'],
    endings: [
      {
        endingId: 'truth',
        title: { 'en-US': 'Truth' },
        summary: { 'en-US': 'Truth wins.' },
        kind: 'truth',
      },
      {
        endingId: 'echo',
        title: { 'en-US': 'Echo' },
        summary: { 'en-US': 'The moment echoes.' },
        kind: 'echo',
      },
    ],
    media: [],
    nodes: [
      {
        nodeId: 'text.start',
        presentation: {
          kind: 'text',
          title: { 'en-US': 'A question' },
          body: { 'en-US': 'The sealed door waits.' },
          completion: 'passive',
        },
        overlays: [],
        exit: {
          kind: 'choice',
          decisionId: 'decision.path',
          prompt: { 'en-US': 'Choose.' },
          choices: [
            {
              choiceId: 'choose.truth',
              label: { 'en-US': 'Open it' },
              nextNodeId: 'text.truth',
            },
            {
              choiceId: 'choose.echo',
              label: { 'en-US': 'Walk away' },
              nextNodeId: 'text.echo',
            },
          ],
        },
      },
      {
        nodeId: 'text.truth',
        presentation: {
          kind: 'text',
          body: { 'en-US': 'The truth is inside.' },
          completion: 'continue',
        },
        overlays: [],
        exit: { kind: 'ending', endingId: 'truth' },
      },
      {
        nodeId: 'text.echo',
        presentation: {
          kind: 'text',
          body: { 'en-US': 'Footsteps fade.' },
          completion: 'continue',
        },
        overlays: [],
        exit: { kind: 'ending', endingId: 'echo' },
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
  it('lowers a text choice to immediately visible core text and choice renderers', () => {
    const result = compileStoryExperienceManifest({
      release: textChoiceRelease(),
      experienceProfile: 'narrative',
      metadata: { title: 'Text Story', summary: null },
      mediaIdentities: [],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest?.metadata.experienceProfile).toBe('narrative');
    const entry = result.manifest?.graph.nodes.find(
      (node) => node.kind === 'scene' && node.sceneId === 'text.start',
    );
    if (!entry || entry.kind !== 'scene') {
      throw new Error('Compiled text entry scene is missing.');
    }
    expect(entry.clock).toEqual({ kind: 'none' });
    const textRenderer = entry.renderers.find(
      (renderer) => renderer.rendererId === EXPERIENCE_CORE_TEXT_RENDERER_ID,
    );
    const choiceRenderer = entry.renderers.find(
      (renderer) => renderer.rendererId === EXPERIENCE_CORE_CHOICE_RENDERER_ID,
    );
    expect(textRenderer?.config).toMatchObject({ completion: 'passive' });
    expect(choiceRenderer?.config).toMatchObject({ initiallyOpen: true });
    const actions = entry.eventBindings.flatMap((binding) =>
      binding.routes.flatMap((route) => route.actions),
    );
    expect(
      actions.some(
        (action) =>
          action.kind === 'renderer.command' && action.commandType === 'open',
      ),
    ).toBe(false);
    const endingScene = result.manifest?.graph.nodes.find(
      (node) => node.kind === 'scene' && node.sceneId === 'text.truth',
    );
    const endingTextRenderer =
      endingScene?.kind === 'scene'
        ? endingScene.renderers.find(
            (renderer) =>
              renderer.rendererId === EXPERIENCE_CORE_TEXT_RENDERER_ID,
          )
        : undefined;
    expect(endingTextRenderer?.config).not.toHaveProperty('title');
    expect(
      endingScene?.kind === 'scene' &&
        endingScene.eventBindings.some(
          (binding) => binding.on.qualifierId === 'text-completed',
        ),
    ).toBe(true);
  });

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

  it('presents narrative video clips inline at native size', () => {
    const base = release();
    const narrative: InteractiveFilmRelease = {
      ...base,
      nodes: base.nodes.map((node) =>
        'presentation' in node && node.presentation.kind === 'video'
          ? {
              ...node,
              presentation: { ...node.presentation, fit: 'native' as const },
            }
          : node,
      ),
    };

    const result = compileStoryExperienceManifest({
      release: narrative,
      experienceProfile: 'narrative',
      metadata: { title: 'Story', summary: null },
      mediaIdentities: [
        {
          runtimeAssetId: 'video:START',
          variantId: VARIANT_ID,
          mediaType: 'video/mp4',
        },
      ],
    });

    expect(result.diagnostics).toEqual([]);
    const videoConfigs =
      result.manifest?.graph.nodes.flatMap((node) =>
        node.kind === 'scene'
          ? node.renderers
              .filter(
                (renderer) =>
                  renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID,
              )
              .map((renderer) => renderer.config as { fit: string })
          : [],
      ) ?? [];
    // Every primary video clip presents inline at native size rather than
    // covering a fixed frame.
    expect(videoConfigs.length).toBeGreaterThan(1);
    expect(videoConfigs.every((config) => config.fit === 'native')).toBe(true);
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
