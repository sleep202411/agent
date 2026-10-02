import { StoryBuildStatus } from '@prisma/client';
import { InteractiveFilmReleaseSchema } from '@repo/shared/interactive-film-runtime';
import type { ExperienceRuntimeManifest } from '@repo/shared/experience-runtime';
import {
  isPlayableStoryBuild,
  storyManifestAccess,
} from './story-build-access';
import { compileStoryExperienceManifest } from './story-experience-manifest-compiler';

const PROJECT_ID = '019f993d-aecc-7020-b59f-3fec0fb7bfc6';
const BUILD_ID = '019f60f4-b101-70d4-8000-00000000a001';
const ASSET_ID = '019f60f4-b101-70d4-8000-00000000b001';
const VARIANT_ID = '019f60f4-b101-70d4-8000-00000000b002';

function manifest(communityPointPrice?: number): ExperienceRuntimeManifest {
  const compiled = compileStoryExperienceManifest({
    release: InteractiveFilmReleaseSchema.parse({
      schemaVersion: 2,
      channel: 'production',
      gameId: PROJECT_ID,
      releaseId: BUILD_ID,
      contentVersion: BUILD_ID,
      entryNodeId: 'scene',
      defaultLocale: 'en-US',
      locales: ['en-US'],
      media: [
        {
          assetId: ASSET_ID,
          kind: 'video',
          orientationPolicy: 'single-master',
          variants: {
            landscape: {
              sourceAssetId: ASSET_ID,
              sha256: 'a'.repeat(64),
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
          nodeId: 'scene',
          ...(communityPointPrice ? { communityPointPrice } : {}),
          presentation: {
            kind: 'video',
            fit: 'cover',
            sequence: [
              {
                clipId: 'clip',
                assetId: ASSET_ID,
                endBehavior: { behavior: 'advance' },
              },
            ],
          },
          exit: { kind: 'auto', nextNodeId: null },
        },
      ],
    }),
    metadata: { title: 'Access' },
    experienceProfile: 'cinematic',
    mediaIdentities: [
      {
        runtimeAssetId: ASSET_ID,
        variantId: VARIANT_ID,
        mediaType: 'video/mp4',
      },
    ],
  }).manifest;
  if (!compiled) throw new Error('fixture manifest did not compile');
  return compiled;
}

describe('storyManifestAccess', () => {
  it('reads a manifest without access rules as free', () => {
    expect(storyManifestAccess(manifest())).toBe('free');
  });

  it('reads a node access rule as paid', () => {
    const paid = manifest(3);
    expect(paid.graph.nodes[0]?.access).toBeDefined();
    expect(storyManifestAccess(paid)).toBe('paid');
  });

  it('reads a route access rule as paid', () => {
    const paid = manifest(3);
    const node = paid.graph.nodes[0];
    const route = node.eventBindings[0]?.routes[0];
    expect(route).toBeDefined();
    route.access = node.access;
    delete node.access;
    expect(storyManifestAccess(paid)).toBe('paid');
  });

  it('fails closed: a manifest that no longer parses is invalid, not free', () => {
    expect(storyManifestAccess(null)).toBe('invalid');
    expect(storyManifestAccess({ ...manifest(), graph: null })).toBe('invalid');
  });
});

describe('isPlayableStoryBuild', () => {
  it('accepts only ready Builds on the current runtime schema', () => {
    expect(
      isPlayableStoryBuild({
        status: StoryBuildStatus.ready,
        runtimeSchemaVersion: 2,
      }),
    ).toBe(true);
    expect(
      isPlayableStoryBuild({
        status: StoryBuildStatus.ready,
        runtimeSchemaVersion: 1,
      }),
    ).toBe(false);
    expect(
      isPlayableStoryBuild({
        status: StoryBuildStatus.compiling,
        runtimeSchemaVersion: 2,
      }),
    ).toBe(false);
  });
});
