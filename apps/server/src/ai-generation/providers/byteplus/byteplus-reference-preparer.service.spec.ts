import { BytePlusReferencePreparerService } from './byteplus-reference-preparer.service';

/** In-memory stand-in for the prisma queries the preparer runs. */
function makeService(opts: {
  /** validate-pass rows keyed by externalAssetId. */
  assetRows?: Array<Record<string, unknown>>;
  /** upgrade-pass active AIGC mirrors. */
  aigcRows?: Array<{
    externalAssetId: string;
    characterMedia: { characterId: string; mediaAssetId: string };
  }>;
  /** upgrade-pass active MediaAsset mirrors (uploads and generated media). */
  mediaRows?: Array<{
    mediaAssetId: string;
    externalAssetId: string;
  }>;
  /** active per-project grant character ids for the job's project. */
  grantedCharacterIds?: string[];
}) {
  const prisma = {
    aiProviderMediaAssetMirror: {
      findMany: jest.fn((args: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        return 'mediaAssetId' in where ? (opts.mediaRows ?? []) : [];
      }),
    },
    aiProviderExternalAsset: {
      // Route by query shape, not call order: the validate pass filters on
      // externalAssetId.in; the upgrade pass filters on assetGroup.groupType.
      findMany: jest.fn((args: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        const isUpgrade = Boolean(
          (where.assetGroup as { groupType?: unknown } | undefined)?.groupType,
        );
        return isUpgrade ? (opts.aigcRows ?? []) : (opts.assetRows ?? []);
      }),
    },
    characterProjectGrant: {
      findMany: jest.fn(() =>
        (opts.grantedCharacterIds ?? []).map((characterId) => ({
          characterId,
        })),
      ),
    },
  };
  const service = new BytePlusReferencePreparerService(prisma as never);
  return { service, prisma };
}

const VIRTUAL_IMAGE_REF = {
  url: 'https://cdn.example.com/hero-front.png',
  refId: 'char-1::1',
  label: 'Hero',
  assetId: 'asset-img-1',
  groupRefId: 'char-1',
  characterId: 'char-1',
};

describe('BytePlusReferencePreparer — AIGC upgrade (virtual)', () => {
  it('upgrades a virtual image ref to asset:// when an active AIGC mirror exists', async () => {
    const { service } = makeService({
      aigcRows: [
        {
          externalAssetId: 'asset-20260410114236-8cdfz',
          characterMedia: {
            characterId: 'char-1',
            mediaAssetId: 'asset-img-1',
          },
        },
      ],
    });
    const out = await service.prepareReferences(
      { referenceImages: [VIRTUAL_IMAGE_REF] },
      'user-1',
      'proj-1',
      'ws-1',
    );
    expect((out.referenceImages as Array<{ url: string }>)[0].url).toBe(
      'asset://asset-20260410114236-8cdfz',
    );
  });

  it('keeps the plain URL when no active AIGC mirror is registered yet', async () => {
    const { service } = makeService({ aigcRows: [] });
    const out = await service.prepareReferences(
      { referenceImages: [VIRTUAL_IMAGE_REF] },
      'user-1',
      'proj-1',
      'ws-1',
    );
    expect((out.referenceImages as Array<{ url: string }>)[0].url).toBe(
      VIRTUAL_IMAGE_REF.url,
    );
  });

  it('upgrades a video ref through the same provider-readiness seam', async () => {
    const { service } = makeService({
      mediaRows: [
        {
          mediaAssetId: 'asset-video-1',
          externalAssetId: 'asset-video-provider-1',
        },
      ],
    });
    const video = {
      url: 'https://cdn.example.com/reference.mp4',
      assetId: 'asset-video-1',
    };

    const out = await service.prepareReferences(
      { referenceVideos: [video] },
      'user-1',
      'proj-1',
      'ws-1',
    );

    expect((out.referenceVideos as Array<{ url: string }>)[0].url).toBe(
      'asset://asset-video-provider-1',
    );
  });

  it('leaves non-character (plain upload) refs untouched', async () => {
    const { service, prisma } = makeService({});
    const plain = { url: 'https://cdn.example.com/upload.png' };
    const out = await service.prepareReferences(
      { referenceImages: [plain] },
      'user-1',
      'proj-1',
      'ws-1',
    );
    expect(out.referenceImages).toEqual([plain]);
    // No character-stamped candidates → the upgrade query never runs.
    expect(prisma.aiProviderExternalAsset.findMany).not.toHaveBeenCalled();
  });
});

describe('BytePlusReferencePreparer — asset:// validation (real_person v2)', () => {
  const activeAssetRow = (over: Record<string, unknown> = {}) => ({
    externalAssetId: 'asset-live-1',
    status: 'active',
    assetGroup: {
      status: 'active',
      character: {
        id: 'char-1',
        name: 'Ada',
        kind: 'real_person',
        status: 'active',
        deletedAt: null,
        subjectUserId: 'user-1',
        workspaceId: 'ws-personal-1',
      },
    },
    ...over,
  });

  it('passes self-use (job owner IS the subject) through', async () => {
    const { service } = makeService({ assetRows: [activeAssetRow()] });
    const input = { referenceImages: [{ url: 'asset://asset-live-1' }] };
    await expect(
      service.prepareReferences(input, 'user-1', 'proj-1', 'ws-personal-1'),
    ).resolves.toBe(input);
  });

  it('passes a granted teammate (not the subject) when an active grant covers the project', async () => {
    const { service } = makeService({
      assetRows: [activeAssetRow()],
      grantedCharacterIds: ['char-1'],
    });
    const input = { referenceImages: [{ url: 'asset://asset-live-1' }] };
    await expect(
      service.prepareReferences(input, 'editor-liz', 'proj-1', 'ws-team'),
    ).resolves.toBe(input);
  });

  it('hard-fails CHARACTER_REVOKED for a non-subject when the grant was withdrawn', async () => {
    const { service } = makeService({
      assetRows: [activeAssetRow()],
      grantedCharacterIds: [], // grant revoked mid-flight
    });
    await expect(
      service.prepareReferences(
        { referenceImages: [{ url: 'asset://asset-live-1' }] },
        'editor-liz',
        'proj-1',
        'ws-team',
      ),
    ).rejects.toMatchObject({ jobError: { code: 'CHARACTER_REVOKED' } });
  });

  it('hard-fails CHARACTER_REVOKED when the character itself was globally revoked', async () => {
    const { service } = makeService({
      assetRows: [
        activeAssetRow({
          assetGroup: {
            status: 'disabled',
            character: {
              id: 'char-1',
              name: 'Ada',
              kind: 'real_person',
              status: 'revoked',
              deletedAt: null,
              subjectUserId: 'user-1',
              workspaceId: 'ws-personal-1',
            },
          },
        }),
      ],
    });
    await expect(
      service.prepareReferences(
        { referenceImages: [{ url: 'asset://asset-live-1' }] },
        'user-1',
        'proj-1',
        'ws-personal-1',
      ),
    ).rejects.toMatchObject({ jobError: { code: 'CHARACTER_REVOKED' } });
  });

  it('hard-fails CHARACTER_ASSET_NOT_READY on an asset:// with no live mirror', async () => {
    const { service } = makeService({ assetRows: [] });
    await expect(
      service.prepareReferences(
        { startFrame: { url: 'asset://asset-ghost' } },
        'user-1',
        'proj-1',
        'ws-personal-1',
      ),
    ).rejects.toMatchObject({
      jobError: { code: 'CHARACTER_ASSET_NOT_READY' },
    });
  });
});
