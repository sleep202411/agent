import { resolveStoryCover } from './story-cover-media';

const COVER_ASSET_ID = '0197f4a2-0800-7000-8000-00000000000a';

function prismaReturning(row: unknown) {
  const queries: unknown[] = [];
  const findFirst = jest.fn((args: unknown) => {
    queries.push(args);
    return Promise.resolve(row);
  });
  return { db: { mediaAsset: { findFirst } }, findFirst, queries };
}

/** A ready image with a permanent public URL. */
function readyImage(objectKey = 'story-cover/hero.jpg') {
  return {
    id: COVER_ASSET_ID,
    storageProvider: 'azure_blob',
    bucket: 'media',
    region: null,
    objectKey,
    externalUrl: null,
    status: 'ready',
    moderationStatus: 'approved',
    deletedAt: null,
    contentType: null,
    width: null,
    height: null,
    checksumSha256: null,
    placements: [
      {
        storageProvider: 'azure_blob',
        bucket: 'media',
        region: null,
        objectKey,
        externalUrl: null,
        publicBaseUrl: 'https://media.example.com',
        role: 'primary',
        status: 'active',
        priority: 10,
        deletedAt: null,
      },
    ],
  };
}

describe('resolveStoryCover', () => {
  it('never queries for a project with no cover', async () => {
    const { db, findFirst } = prismaReturning(readyImage());

    expect(await resolveStoryCover(db as never, null)).toEqual({
      reference: null,
      eligibilityDiagnostics: [],
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('resolves a cover from its public URL without requiring technical metadata', async () => {
    const { db, queries } = prismaReturning(readyImage());

    const cover = await resolveStoryCover(db as never, COVER_ASSET_ID);

    // No signature and no expiry: a catalogue tile and an og:image crawler
    // cannot follow a short-lived signed link.
    expect(cover).toEqual({
      reference: {
        mediaAssetId: COVER_ASSET_ID,
        url: 'https://media.example.com/story-cover/hero.jpg',
      },
      eligibilityDiagnostics: [],
    });
    // Image-kind stays a query predicate — a cover has to be a still. Workspace
    // does NOT: uploads record no workspace, so scoping by it made an uploaded
    // cover unpublishable, and the id was already accepted when the cover was
    // set on a project the caller may edit.
    expect(queries[0]).toMatchObject({
      where: { id: COVER_ASSET_ID, kind: 'image' },
    });
    expect(
      (queries[0] as { where: Record<string, unknown> }).where,
    ).not.toHaveProperty('workspaceId');
  });

  /**
   * The contract of this module: it can refuse to publish a cover, but it can
   * never fail a Build. Every refusal is a WARNING, because the creator set that
   * cover on purpose and a silent drop would leave them with a black title
   * screen and no explanation.
   */
  it('warns rather than failing for media that must not be served', async () => {
    for (const unusable of [
      null,
      { ...readyImage(), deletedAt: new Date() },
      { ...readyImage(), status: 'processing' },
      { ...readyImage(), moderationStatus: 'blocked' },
      { ...readyImage(), objectKey: null, bucket: null, placements: [] },
    ]) {
      const { db } = prismaReturning(unusable);

      const cover = await resolveStoryCover(db as never, COVER_ASSET_ID);

      expect(cover.reference).toBeNull();
      expect(cover.eligibilityDiagnostics).toEqual([
        expect.objectContaining({
          severity: 'warning',
          code: 'STORY_BUILD_COVER_UNUSABLE',
          entityType: 'asset',
          entityId: COVER_ASSET_ID,
        }),
      ]);
    }
  });

  it('refuses a cover whose URL is not public HTTP media', async () => {
    const misconfigured = {
      ...readyImage(),
      storageProvider: 'external_url',
      externalUrl: 'ftp://media.example.com/cover.jpg',
      placements: [],
    };
    const { db } = prismaReturning(misconfigured);

    const cover = await resolveStoryCover(db as never, COVER_ASSET_ID);

    expect(cover.reference).toBeNull();
    expect(cover.eligibilityDiagnostics).toHaveLength(1);
  });
});
