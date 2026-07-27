import { resolveStoryCover } from './story-cover-media';

const WORKSPACE_ID = '0197f4a2-0800-7000-8000-00000000aa01';
const COVER_ASSET_ID = '0197f4a2-0800-7000-8000-00000000000a';
const CHECKSUM = 'c'.repeat(64);

function prismaReturning(row: unknown) {
  const queries: unknown[] = [];
  const findFirst = jest.fn((args: unknown) => {
    queries.push(args);
    return Promise.resolve(row);
  });
  return { db: { mediaAsset: { findFirst } }, findFirst, queries };
}

/** A ready, resolvable image with everything a runtime image variant requires. */
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
    contentType: 'image/jpeg',
    width: 1600,
    height: 900,
    checksumSha256: CHECKSUM,
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

    expect(await resolveStoryCover(db as never, WORKSPACE_ID, null)).toEqual({
      asset: null,
      eligibilityDiagnostics: [],
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('resolves a cover to its plain public media URL and pixel identity', async () => {
    const { db, queries } = prismaReturning(readyImage());

    const cover = await resolveStoryCover(
      db as never,
      WORKSPACE_ID,
      COVER_ASSET_ID,
    );

    // No signature and no expiry: a catalogue tile and an og:image crawler
    // cannot follow a short-lived signed link.
    expect(cover).toEqual({
      asset: {
        mediaAssetId: COVER_ASSET_ID,
        url: 'https://media.example.com/story-cover/hero.jpg',
        sha256: CHECKSUM,
        width: 1600,
        height: 900,
        mediaType: 'image/jpeg',
      },
      eligibilityDiagnostics: [],
    });
    // Workspace and image-kind are query predicates: another workspace's asset
    // must never be published inside someone else's release, and a cover has to
    // be a still.
    expect(queries[0]).toMatchObject({
      where: { id: COVER_ASSET_ID, workspaceId: WORKSPACE_ID, kind: 'image' },
    });
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

      const cover = await resolveStoryCover(
        db as never,
        WORKSPACE_ID,
        COVER_ASSET_ID,
      );

      expect(cover.asset).toBeNull();
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

  /**
   * A runtime IMAGE variant requires sha256, width and height — video relaxes
   * exactly those three. An image that never went through the verified-upload
   * probe can be missing any of them, and that is not a publishable cover.
   */
  it('refuses a cover missing the metadata an image variant requires', async () => {
    for (const incomplete of [
      { ...readyImage(), checksumSha256: null },
      { ...readyImage(), checksumSha256: 'not-a-sha' },
      { ...readyImage(), width: null },
      { ...readyImage(), height: 0 },
      { ...readyImage(), contentType: null },
    ]) {
      const { db } = prismaReturning(incomplete);

      const cover = await resolveStoryCover(
        db as never,
        WORKSPACE_ID,
        COVER_ASSET_ID,
      );

      expect(cover.asset).toBeNull();
      expect(cover.eligibilityDiagnostics).toHaveLength(1);
    }
  });

  /**
   * A release carries a root-relative path or a permanent HTTPS URL and nothing
   * else. An `http://` external asset would pass this resolver and then fail the
   * release parse — a cover failing a whole Build, which this module exists to
   * make impossible.
   */
  it('refuses a cover whose URL shape a release could not carry', async () => {
    const misconfigured = readyImage();
    misconfigured.placements[0].publicBaseUrl = 'http://media.example.com';
    const { db } = prismaReturning(misconfigured);

    const cover = await resolveStoryCover(
      db as never,
      WORKSPACE_ID,
      COVER_ASSET_ID,
    );

    expect(cover.asset).toBeNull();
    expect(cover.eligibilityDiagnostics).toHaveLength(1);
  });
});
