import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canonicalizeExperienceJson,
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  ExperienceRuntimeManifestSchema,
} from '@repo/shared/experience-runtime';
import { buildHuBaoVillaImportBundle } from './import/hu-bao-villa.builder';
import {
  compileStoryExperienceManifest,
  STORY_CORE_THEME_CONFIG_ASSET_ID,
  type StoryExperienceMediaIdentity,
} from './story-experience-manifest-compiler';
import {
  compileStoryFilmBuild,
  type StoryFilmBuildClipInput,
} from './story-film-build-compiler';

const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const REVISION_ID = '0197f4a2-0800-7000-8000-000000000003';
const BUILD_ID = '0197f4a2-0800-7000-8000-000000000004';

function uuid(index: number, group: string): string {
  return `0197f4a2-${group}-7000-8000-${index.toString(16).padStart(12, '0')}`;
}

function fixture() {
  const bundle = buildHuBaoVillaImportBundle();
  const clips: StoryFilmBuildClipInput[] = bundle.clipSpecs.map(
    (spec, index) => ({
      id: uuid(index + 1, '2000'),
      key: spec.key,
      graphNodeId: spec.graphNodeId,
      rank: spec.rank,
      specHash: `${(index + 1).toString(16).padStart(64, '0')}`,
      productionInputHash: `${(index + 101).toString(16).padStart(64, '0')}`,
      spec,
      sourceGenerationId: uuid(index + 1, '3000'),
      asset: {
        assetId: uuid(index + 1, '4000'),
        variantId: uuid(index + 1, '5000'),
        checksumSha256: `${(index + 201).toString(16).padStart(64, '0')}`,
        contentType: 'video/mp4',
        sizeBytes: 1_000n,
        width: 1920,
        height: 1080,
        durationMs: 15_000,
        url: `https://cdn.example.test/${spec.key}.mp4`,
      },
      eligibilityDiagnostics: [],
    }),
  );
  const built = compileStoryFilmBuild({
    projectId: PROJECT_ID,
    revisionId: REVISION_ID,
    revisionNumber: 1,
    buildId: BUILD_ID,
    profile: 'production',
    scope: { kind: 'full' },
    draft: bundle.draftContent,
    filmSpec: bundle.filmSpec,
    clips,
  });
  if (!built.runtime) throw new Error('Film fixture did not compile.');
  return {
    bundle,
    clips,
    release: built.runtime,
    mediaIdentities: clips.map(
      (clip): StoryExperienceMediaIdentity => ({
        runtimeAssetId: `video:${clip.key}`,
        variantId: clip.asset?.variantId as string,
        mediaType: clip.asset?.contentType as string,
      }),
    ),
  };
}

function compileFixture() {
  const value = fixture();
  const result = compileStoryExperienceManifest({
    release: value.release,
    metadata: {
      title: '虎豹别墅：龙口入夜',
      summary: value.bundle.draftContent.storyBible.logline,
    },
    stateVariables: value.bundle.draftContent.storyBible.stateVariables,
    mediaIdentities: value.mediaIdentities,
  });
  return { ...value, result };
}

describe('Story Runtime Manifest v2 compiler', () => {
  it('compiles the complete film Build into one deterministic v2 manifest', () => {
    const first = compileFixture();
    const second = compileFixture();

    expect(first.result.diagnostics).toEqual([]);
    expect(first.result.manifest).not.toBeNull();
    expect(first.result.manifest).toEqual(second.result.manifest);
    expect(
      ExperienceRuntimeManifestSchema.safeParse(first.result.manifest).success,
    ).toBe(true);
    expect(first.result.manifest).toMatchObject({
      manifestType: 'fizzdragon.experience',
      schemaVersion: 2,
      gameId: PROJECT_ID,
      buildId: BUILD_ID,
      contentVersion: `build:${BUILD_ID}`,
      completionPolicy: 'finite',
      metadata: {
        title: {
          'zh-CN': '虎豹别墅：龙口入夜',
        },
      },
    });
    expect(first.result.manifest?.assets).toHaveLength(22);
    expect(
      first.result.manifest?.assets.find(
        (asset) => asset.assetId === STORY_CORE_THEME_CONFIG_ASSET_ID,
      ),
    ).toMatchObject({
      kind: 'data',
      uri: '/experience-runtime/themes/core.film-dark.v1.json',
    });
    expect(
      first.result.manifest?.rendererRequirements.map(
        (renderer) => renderer.rendererId,
      ),
    ).toEqual(
      expect.arrayContaining([
        EXPERIENCE_CORE_VIDEO_RENDERER_ID,
        EXPERIENCE_CORE_CHOICE_RENDERER_ID,
      ]),
    );
    expect(
      first.result.manifest?.graph.nodes.some(
        (node) =>
          node.kind === 'router' &&
          node.eventBindings[0]?.on.type === 'scene.entered',
      ),
    ).toBe(true);
    expect(first.result.manifest?.endings).toHaveLength(4);
    expect(
      first.result.manifest?.stateDefinitions.map((state) => state.key),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/^story\./)]));
  });

  it('preserves reaction playback as an explicit scene before navigation', () => {
    const value = fixture();
    const release = structuredClone(value.release);
    const choiceNode = release.nodes.find(
      (node) => node.exit.kind === 'choice',
    );
    if (!choiceNode || choiceNode.exit.kind !== 'choice') {
      throw new Error('Choice node missing.');
    }
    const choice = choiceNode.exit.choices[0];
    if (!choice) throw new Error('Choice missing.');
    choice.afterSelect = {
      kind: 'play',
      reactionAssetId: 'video:E01',
    };
    const result = compileStoryExperienceManifest({
      release,
      metadata: { title: 'Reaction test' },
      stateVariables: value.bundle.draftContent.storyBible.stateVariables,
      mediaIdentities: value.mediaIdentities,
    });

    expect(result.diagnostics).toEqual([]);
    const syntheticId = `reaction:${choiceNode.nodeId}:${choice.choiceId}`;
    const synthetic = result.manifest?.graph.nodes.find(
      (node) => node.sceneId === syntheticId,
    );
    expect(synthetic).toMatchObject({
      kind: 'scene',
      renderers: [
        {
          rendererId: EXPERIENCE_CORE_VIDEO_RENDERER_ID,
          config: {
            sequence: [
              {
                assetId: 'video:E01',
              },
            ],
          },
        },
      ],
    });
    const original = result.manifest?.graph.nodes.find(
      (node) => node.sceneId === choiceNode.nodeId,
    );
    expect(JSON.stringify(original)).toContain(syntheticId);
    expect(JSON.stringify(synthetic)).toContain(choice.nextNodeId);
  });

  it('assigns a distinct Java content version to every immutable Build', () => {
    const value = fixture();
    const nextBuildId = uuid(5, '0800');
    const nextRelease = {
      ...value.release,
      releaseId: nextBuildId,
    };
    const first = compileStoryExperienceManifest({
      release: value.release,
      metadata: { title: 'Version identity' },
      stateVariables: value.bundle.draftContent.storyBible.stateVariables,
      mediaIdentities: value.mediaIdentities,
    });
    const next = compileStoryExperienceManifest({
      release: nextRelease,
      metadata: { title: 'Version identity' },
      stateVariables: value.bundle.draftContent.storyBible.stateVariables,
      mediaIdentities: value.mediaIdentities,
    });

    expect(first.manifest?.contentVersion).toBe(`build:${BUILD_ID}`);
    expect(next.manifest?.contentVersion).toBe(`build:${nextBuildId}`);
    expect(next.manifest?.contentVersion).not.toBe(
      first.manifest?.contentVersion,
    );
  });

  it('fails loudly when a frozen media variant identity is missing', () => {
    const value = fixture();
    const result = compileStoryExperienceManifest({
      release: value.release,
      metadata: { title: 'Missing variant' },
      stateVariables: value.bundle.draftContent.storyBible.stateVariables,
      mediaIdentities: value.mediaIdentities.slice(1),
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

  it('keeps the built-in theme bytes identical across Studio and Web', () => {
    const studio = readTheme(
      resolve(
        process.cwd(),
        '../studio/public/experience-runtime/themes/core.film-dark.v1.json',
      ),
    );
    const web = readTheme(
      resolve(
        process.cwd(),
        '../web/public/experience-runtime/themes/core.film-dark.v1.json',
      ),
    );
    expect(studio).toEqual(web);
    expect(
      createHash('sha256')
        .update(canonicalizeExperienceJson(studio))
        .digest('hex'),
    ).toBe('c5fd632a6dcba38e80c84a1bc771c37e791af6bca73421a9c357f859610e6272');
  });
});

function readTheme(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}
