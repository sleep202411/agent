import {
  StoryCommunityAccessService,
  storyPurchaseKey,
} from './story-community-access.service';
import { compileStoryExperienceManifest } from './story-experience-manifest-compiler';
import { InteractiveFilmReleaseSchema } from '@repo/shared/interactive-film-runtime';
import type { AuthUser } from '../auth';
const projectId = '0197f4a2-0800-7000-8000-000000000001';
const buildId = '0197f4a2-0800-7000-8000-000000000002';
const freeAsset = '0197f4a2-0800-7000-8000-000000000003';
const paidAsset = '0197f4a2-0800-7000-8000-000000000004';
const variantId = '0197f4a2-0800-7000-8000-000000000005';
const key = 'node:paid';
function fixture(owned = false) {
  const manifest = compileStoryExperienceManifest({
    release: InteractiveFilmReleaseSchema.parse({
      schemaVersion: 2,
      channel: 'production',
      gameId: projectId,
      releaseId: buildId,
      contentVersion: buildId,
      entryNodeId: 'start',
      defaultLocale: 'en-US',
      locales: ['en-US'],
      media: [freeAsset, paidAsset].map((assetId) => ({
        assetId,
        kind: 'video',
        orientationPolicy: 'single-master',
        variants: {
          landscape: {
            sourceAssetId: assetId,
            sha256: 'a'.repeat(64),
            src: `/aurora/story-projects/${projectId}/builds/${buildId}/assets/${assetId}/variants/${variantId}/content`,
            width: 1920,
            height: 1080,
            durationSeconds: 5,
          },
        },
      })),
      nodes: [
        {
          nodeId: 'start',
          presentation: { kind: 'decision' },
          exit: {
            kind: 'choice',
            decisionId: 'routes',
            prompt: { 'en-US': 'Choose' },
            choices: [
              {
                choiceId: 'paid',
                label: { 'en-US': 'Paid' },
                nextNodeId: 'paid',
              },
              {
                choiceId: 'free',
                label: { 'en-US': 'Free' },
                nextNodeId: 'free',
              },
            ],
          },
        },
        ...[
          ['paid', paidAsset],
          ['free', freeAsset],
        ].map(([nodeId, assetId]) => ({
          nodeId,
          communityPointPrice: nodeId === 'paid' ? 20 : undefined,
          presentation: {
            kind: 'video',
            sequence: [
              { clipId: nodeId, assetId, endBehavior: { behavior: 'advance' } },
            ],
            fit: 'cover',
          },
          exit: { kind: 'auto', nextNodeId: null },
        })),
      ],
    }),
    experienceProfile: 'cinematic',
    metadata: { title: 'Film' },
    mediaIdentities: [freeAsset, paidAsset].map((runtimeAssetId) => ({
      runtimeAssetId,
      variantId,
      mediaType: 'video/mp4',
    })),
  }).manifest;
  const build = {
    runtimeJson: manifest,
    assets: [],
    project: { createdByUserId: 'creator' },
    experiencePublication: null,
    experienceDraftRelease: { status: 'pending' },
    gameReleaseChapters: [],
  };
  const prisma = {
    storyBuild: { findFirst: jest.fn().mockResolvedValue(build) },
    walletTransaction: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          owned
            ? [{ idempotencyKey: storyPurchaseKey('viewer', projectId, key) }]
            : [],
        ),
    },
  };
  return {
    service: new StoryCommunityAccessService(prisma as never, {} as never),
    build,
  };
}
describe('published story media access', () => {
  it('denies the paid branch to anonymous visitors while keeping the free branch playable', async () => {
    const { service } = fixture();
    await expect(
      service.requireAssetAccess(
        undefined,
        projectId,
        buildId,
        paidAsset,
        variantId,
      ),
    ).rejects.toThrow('Unlock this content');
    await expect(
      service.requireAssetAccess(
        undefined,
        projectId,
        buildId,
        freeAsset,
        variantId,
      ),
    ).resolves.toBeUndefined();
  });
  it('authorizes the paid branch after a posted purchase, and refuses unknown media', async () => {
    const { service } = fixture(true);
    await expect(
      service.requireAssetAccess(
        { userId: 'viewer' } as AuthUser,
        projectId,
        buildId,
        paidAsset,
        variantId,
      ),
    ).resolves.toBeUndefined();
    await expect(
      service.requireAssetAccess(
        undefined,
        projectId,
        buildId,
        'unknown',
        variantId,
      ),
    ).rejects.toThrow('not part of the released story');
  });
  it('does not authorize media when the publication is revoked', async () => {
    const { service, build } = fixture(true);
    build.experienceDraftRelease.status = 'rejected';
    await expect(
      service.requireAssetAccess(
        { userId: 'viewer' } as AuthUser,
        projectId,
        buildId,
        paidAsset,
        variantId,
      ),
    ).rejects.toThrow('not available');
  });
});
