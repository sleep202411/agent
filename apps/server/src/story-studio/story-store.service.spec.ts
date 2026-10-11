/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers inspect the exact Prisma authorization query. */
import { StoryStoreService } from './story-store.service';

const GAME_ID = crypto.randomUUID();
const COVER_ID = crypto.randomUUID();
function externalAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    kind: overrides.kind ?? 'image',
    storageProvider: 'external_url',
    bucket: null,
    region: null,
    objectKey: null,
    externalUrl:
      overrides.externalUrl ?? `https://cdn.example/${crypto.randomUUID()}`,
    status: overrides.status ?? 'ready',
    moderationStatus: overrides.moderationStatus ?? 'approved',
    deletedAt: null,
  };
}
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Frozen title',
    defaultLocale: 'en-US',
    coverAssetId: COVER_ID,
    listing: {
      description: 'A branching film\n\nChoose your own path.\n\nFind a story.',
      tags: ['Drama', 'Multiple endings'],
      developer: 'Crew',
      trailerAssetId: null,
      screenshotAssetIds: [],
      ...overrides,
    },
  };
}
function projectRow(
  listingSnapshot: unknown,
  kind: 'single' | 'serial' = 'serial',
) {
  return {
    id: GAME_ID,
    // Mutable drafts must never be consumed by the public read.
    title: 'Unreviewed title',
    storeListing: { description: 'Unreviewed description' },
    experienceGameReleases: kind === 'serial' ? [{ listingSnapshot }] : [],
    experienceDraftReleases: kind === 'single' ? [{ listingSnapshot }] : [],
  };
}

describe('StoryStoreService', () => {
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const currentPublicVersion = jest.fn();
  const service = new StoryStoreService(
    { storyProject: { findFirst }, mediaAsset: { findMany } } as never,
    { currentPublicVersion } as never,
  );
  beforeEach(() => {
    findFirst.mockReset();
    findMany.mockReset().mockResolvedValue([]);
    currentPublicVersion.mockReset().mockResolvedValue('public-version');
  });

  it('serves a minimal published listing without a cover or description', async () => {
    findFirst.mockResolvedValue(
      projectRow({ ...snapshot({ description: '' }), coverAssetId: null }),
    );
    const listing = await service.getListing(GAME_ID);
    expect(listing).toMatchObject({
      coverUrl: null,
      description: '',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [] } } }),
    );
    expect(listing).not.toHaveProperty('coverStatus');
  });
  it('distinguishes an omitted cover from an unavailable cover during review', async () => {
    findFirst.mockResolvedValue(
      projectRow({ ...snapshot({ description: '' }), coverAssetId: null }),
    );
    await expect(
      service.getReviewListing(GAME_ID, 'candidate-v2'),
    ).resolves.toMatchObject({
      coverUrl: null,
      coverStatus: 'not_provided',
      description: '',
    });
  });
  it('reports a usable selected cover as available during review', async () => {
    const cover = externalAsset({ id: COVER_ID });
    findFirst.mockResolvedValue(projectRow(snapshot()));
    findMany.mockResolvedValue([cover]);
    await expect(
      service.getReviewListing(GAME_ID, 'candidate-v2'),
    ).resolves.toMatchObject({
      coverUrl: cover.externalUrl,
      coverStatus: 'available',
    });
  });
  it.each([
    'missing',
    'blocked',
    'processing',
    'deleted',
    'wrong kind',
    'unresolvable',
  ])(
    'does not treat a %s selected cover as an omitted cover',
    async (condition) => {
      const cover = {
        ...externalAsset({ id: COVER_ID }),
        ...(condition === 'blocked' ? { moderationStatus: 'blocked' } : {}),
        ...(condition === 'processing' ? { status: 'processing' } : {}),
        ...(condition === 'deleted' ? { deletedAt: new Date() } : {}),
        ...(condition === 'wrong kind' ? { kind: 'video' } : {}),
        ...(condition === 'unresolvable' ? { externalUrl: null } : {}),
      };
      findFirst.mockResolvedValue(projectRow(snapshot()));
      findMany.mockResolvedValue(condition === 'missing' ? [] : [cover]);
      await expect(
        service.getReviewListing(GAME_ID, 'candidate-v2'),
      ).resolves.toMatchObject({
        coverUrl: null,
        coverStatus: 'unavailable',
      });
    },
  );
  it('does not expose reviewing or offline works even when a release receipt exists', async () => {
    currentPublicVersion.mockResolvedValue(null);
    expect(await service.getListing(GAME_ID)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('does not backfill historical releases from a mutable draft', async () => {
    findFirst.mockResolvedValue(projectRow(null));
    expect(await service.getListing(GAME_ID)).toBeNull();
  });
  it('verifies historical Java works then returns null without querying UUID project fields', async () => {
    await expect(service.getListing('legacyfilm_1')).resolves.toBeNull();
    expect(currentPublicVersion).toHaveBeenCalledWith('legacyfilm_1');
    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
  it.each(['single', 'serial'] as const)(
    'serves the frozen introduction of an authorized %s version',
    async (kind) => {
      const shot1 = externalAsset();
      const shot2 = externalAsset();
      const cover = externalAsset({
        id: COVER_ID,
        externalUrl: 'https://cdn.example/cover.jpg',
      });
      findFirst.mockResolvedValue(
        projectRow(
          snapshot({ screenshotAssetIds: [shot2.id, shot1.id] }),
          kind,
        ),
      );
      findMany.mockResolvedValue([cover, shot1, shot2]);
      const dto = await service.getListing(GAME_ID);
      expect(dto).toMatchObject({
        gameId: GAME_ID,
        title: 'Frozen title',
        description:
          'A branching film\n\nChoose your own path.\n\nFind a story.',
        developer: 'Crew',
        tags: ['Drama', 'Multiple endings'],
        coverUrl: cover.externalUrl,
      });
      expect(dto).not.toHaveProperty('genres');
      expect(dto).not.toHaveProperty('tagline');
      expect(dto).not.toHaveProperty('shortDescription');
      expect(dto).not.toHaveProperty('aboutParagraphs');
      expect(dto?.screenshots).toEqual([
        { url: shot2.externalUrl },
        { url: shot1.externalUrl },
      ]);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            experienceGameReleases: expect.objectContaining({
              where: expect.objectContaining({
                contentVersion: 'public-version',
              }),
            }),
            experienceDraftReleases: expect.objectContaining({
              where: expect.objectContaining({
                contentVersion: 'public-version',
              }),
            }),
          }),
        }),
      );
    },
  );
  it('serves an authorized introduction without creator metadata', async () => {
    const cover = externalAsset({ id: COVER_ID });
    findFirst.mockResolvedValue(projectRow(snapshot({ developer: '' })));
    findMany.mockResolvedValue([cover]);
    await expect(service.getListing(GAME_ID)).resolves.toMatchObject({
      gameId: GAME_ID,
      description: snapshot().listing.description,
      developer: '',
      coverUrl: cover.externalUrl,
    });
  });

  it.each(['public', 'review'] as const)(
    'resolves the current original placement for %s promotional media instead of the legacy asset URL',
    async (audience) => {
      const ids = [COVER_ID, crypto.randomUUID(), crypto.randomUUID()];
      const assets = ids.map((id, index) => ({
        ...externalAsset({ id, kind: index === 1 ? 'video' : 'image' }),
        externalUrl: `https://legacy.example/${id}`,
        placements: [
          {
            variantId: 'poster-variant',
            storageProvider: 'external_url',
            externalUrl: `https://derived.example/${id}.jpg`,
            role: 'primary',
            status: 'active',
            priority: 0,
            deletedAt: null,
            bucket: null,
            region: null,
            objectKey: null,
          },
        ],
        variants: [
          {
            variantKey: 'original',
            status: 'ready',
            deletedAt: null,
            placements: [
              {
                storageProvider: 'external_url',
                externalUrl: `https://current.example/${id}`,
                role: 'primary',
                status: 'active',
                priority: 0,
                deletedAt: null,
                bucket: null,
                region: null,
                objectKey: null,
              },
            ],
          },
        ],
      }));
      findFirst.mockResolvedValue(
        projectRow(
          snapshot({
            trailerAssetId: ids[1],
            screenshotAssetIds: [ids[2]],
          }),
        ),
      );
      // Reflect Prisma projection: an omitted relation is not available to the resolver.
      findMany.mockImplementation(
        ({ select }: { select: Record<string, unknown> }) =>
          Promise.resolve(
            assets.map(({ placements, variants, ...legacy }) => ({
              ...legacy,
              ...(select.placements ? { placements } : {}),
              ...(select.variants ? { variants } : {}),
            })),
          ),
      );
      const dto =
        audience === 'public'
          ? await service.getListing(GAME_ID)
          : await service.getReviewListing(GAME_ID, 'candidate-v2');
      expect(dto).toMatchObject({
        coverUrl: `https://current.example/${ids[0]}`,
        trailerUrl: `https://current.example/${ids[1]}`,
        screenshots: [{ url: `https://current.example/${ids[2]}` }],
      });
    },
  );
  it('retains both label lists from an existing frozen introduction', async () => {
    const legacySnapshot = snapshot();
    const savedListing: Record<string, unknown> = {
      ...legacySnapshot.listing,
    };
    delete savedListing.description;
    findFirst.mockResolvedValue(
      projectRow({
        ...legacySnapshot,
        listing: {
          ...savedListing,
          tagline: ' A branching film ',
          shortDescription: 'Choose your own path.',
          aboutParagraphs: ['Find a story.'],
          genres: ['Drama', 'Mystery'],
          tags: ['Mystery', 'Multiple endings'],
        },
      }),
    );
    const dto = await service.getListing(GAME_ID);
    expect(dto?.description).toEqual(
      'A branching film\n\nChoose your own path.\n\nFind a story.',
    );
    expect(dto?.tags).toEqual(['Drama', 'Mystery', 'Multiple endings']);
    expect(dto).not.toHaveProperty('genres');
    expect(dto).not.toHaveProperty('tagline');
    expect(dto).not.toHaveProperty('shortDescription');
    expect(dto).not.toHaveProperty('aboutParagraphs');
  });
  it('continues enforcing asset moderation on a frozen version', async () => {
    const blocked = externalAsset({ moderationStatus: 'blocked' });
    const pending = externalAsset({ status: 'processing' });
    const trailer = externalAsset({ kind: 'image' });
    findFirst.mockResolvedValue(
      projectRow(
        snapshot({
          trailerAssetId: trailer.id,
          screenshotAssetIds: [blocked.id, pending.id, crypto.randomUUID()],
        }),
      ),
    );
    findMany.mockResolvedValue([blocked, pending, trailer]);
    const dto = await service.getListing(GAME_ID);
    expect(dto?.trailerUrl).toBeNull();
    expect(dto?.screenshots).toEqual([]);
  });
  it('propagates authority failure without revealing draft or stale release metadata', async () => {
    currentPublicVersion.mockRejectedValue(new Error('Authority unavailable'));
    await expect(service.getListing(GAME_ID)).rejects.toThrow(
      'Authority unavailable',
    );
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('reads the exact frozen review snapshot without consulting public authority or mutable drafts', async () => {
    findFirst.mockResolvedValue(projectRow(snapshot()));
    const dto = await service.getReviewListing(GAME_ID, 'review-candidate-v2');
    expect(dto?.description).toBe(snapshot().listing.description);
    expect(dto?.title).toBe('Frozen title');
    expect(currentPublicVersion).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: GAME_ID },
      select: {
        id: true,
        experienceGameReleases: {
          where: { contentVersion: 'review-candidate-v2' },
          select: { listingSnapshot: true },
          take: 1,
        },
        experienceDraftReleases: {
          where: { contentVersion: 'review-candidate-v2' },
          select: { listingSnapshot: true },
          take: 1,
        },
      },
    });
  });

  it('returns null for historical review versions without snapshots and legacy non-UUID works', async () => {
    findFirst.mockResolvedValue(projectRow(null));
    await expect(
      service.getReviewListing(GAME_ID, 'legacy-v1'),
    ).resolves.toBeNull();
    findFirst.mockClear();
    await expect(
      service.getReviewListing('legacyfilm_1', 'legacy-v1'),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('reports invalid review snapshots instead of presenting them as historical empty data', async () => {
    findFirst.mockResolvedValue(
      projectRow({ ...snapshot(), coverAssetId: 'invalid' }),
    );
    await expect(
      service.getReviewListing(GAME_ID, 'candidate-v2'),
    ).rejects.toMatchObject({
      response: { code: 'STORY_PUBLICATION_LISTING_INVALID' },
    });
  });

  it('reports a damaged public snapshot instead of hiding it behind the historical fallback', async () => {
    findFirst.mockResolvedValue(
      projectRow({ ...snapshot(), coverAssetId: 'invalid' }),
    );
    await expect(service.getListing(GAME_ID)).rejects.toMatchObject({
      response: {
        code: 'STORY_PUBLICATION_LISTING_INVALID',
        message:
          'The published promotional materials are invalid and cannot be displayed.',
      },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('refuses ambiguous snapshots from duplicate single and serial release identities', async () => {
    findFirst.mockResolvedValue({
      id: GAME_ID,
      experienceGameReleases: [{ listingSnapshot: snapshot() }],
      experienceDraftReleases: [{ listingSnapshot: snapshot() }],
    });
    await expect(
      service.getReviewListing(GAME_ID, 'candidate-v2'),
    ).rejects.toMatchObject({
      response: { code: 'STORY_PUBLICATION_LISTING_INVALID' },
    });
    await expect(service.getListing(GAME_ID)).rejects.toMatchObject({
      response: {
        code: 'STORY_PUBLICATION_LISTING_INVALID',
        message:
          'The published promotional materials are invalid and cannot be displayed.',
      },
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});
