import { S3CompatibleStorageService } from '../infra/storage/s3-storage.service';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash, canonicalJsonString } from './canonical-json';
import {
  StoryChapterManifestStorageService,
  storyChapterManifestKey,
} from './story-chapter-manifest-storage.service';

const PROJECT_ID = '019f993d-aecc-7020-b59f-3fec0fb7bfc6';
const OTHER_PROJECT_ID = '019f993d-aecc-7020-b59f-3fec0fb7bfc7';
const BUILD_ID = '019f60f4-b101-70d4-8000-00000000a001';
const OTHER_BUILD_ID = '019f60f4-b101-70d4-8000-00000000a002';
const PUBLIC_BASE_URL = 'https://r2.fizzdragon.com';

// Any JSON object exercises the canonical-bytes contract; the manifest schema
// is enforced where the manifest is produced, not by the object store.
const MANIFEST = {
  manifestType: 'fizzdragon.experience',
  buildId: BUILD_ID,
  contentVersion: BUILD_ID,
} as never;
const MANIFEST_HASH = canonicalJsonHash(MANIFEST);

function serviceWith(upload = jest.fn(uploadResult)) {
  const storage = new S3CompatibleStorageService();
  storage.upload = upload;
  const service = new StoryChapterManifestStorageService(
    storage,
    new MediaAssetUrlResolverService(),
  );
  return { service, upload };
}

function uploadResult({ key, body }: { key: string; body: Buffer }) {
  return Promise.resolve({
    url: `https://internal.r2.test/${key}`,
    storagePath: key,
    bytes: body.byteLength,
    provider: 's3_compatible' as const,
    bucket: 'fizzdragon-media',
    region: 'auto',
  });
}

describe('storyChapterManifestKey', () => {
  it('cannot collide across projects, chapters or rebuilds', () => {
    const keys = new Set([
      storyChapterManifestKey({
        projectId: PROJECT_ID,
        buildId: BUILD_ID,
        runtimeHash: MANIFEST_HASH,
      }),
      // Same content in another project: still its own object, so a takedown
      // in one project can never reach another project's chapter.
      storyChapterManifestKey({
        projectId: OTHER_PROJECT_ID,
        buildId: BUILD_ID,
        runtimeHash: MANIFEST_HASH,
      }),
      // Another chapter, and a rebuild of the same chapter, are other Builds.
      storyChapterManifestKey({
        projectId: PROJECT_ID,
        buildId: OTHER_BUILD_ID,
        runtimeHash: MANIFEST_HASH,
      }),
      storyChapterManifestKey({
        projectId: PROJECT_ID,
        buildId: BUILD_ID,
        runtimeHash: 'b'.repeat(64),
      }),
    ]);

    expect(keys.size).toBe(4);
  });

  it('is stable for the same Build', () => {
    const object = {
      projectId: PROJECT_ID,
      buildId: BUILD_ID,
      runtimeHash: MANIFEST_HASH,
    };

    expect(storyChapterManifestKey(object)).toBe(
      storyChapterManifestKey(object),
    );
  });
});

describe('StoryChapterManifestStorageService', () => {
  const previousEnv = { ...process.env };
  const object = {
    projectId: PROJECT_ID,
    buildId: BUILD_ID,
    runtimeHash: MANIFEST_HASH,
  };

  beforeEach(() => {
    process.env.MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE = PUBLIC_BASE_URL;
    process.env.S3_BUCKET = 'fizzdragon-media';
    process.env.S3_REGION = 'auto';
    process.env.S3_ENDPOINT = 'https://test.r2.cloudflarestorage.com';
    process.env.S3_ACCESS_KEY_ID = 'test';
    process.env.S3_ACCESS_KEY_SECRET = 'test';
  });

  afterAll(() => {
    process.env = previousEnv;
  });

  it('resolves the public bucket domain, not the storage endpoint', () => {
    const { service } = serviceWith();

    expect(service.publicUrl(object)).toBe(
      `${PUBLIC_BASE_URL}/${storyChapterManifestKey(object)}`,
    );
  });

  it('refuses to publish a URL it cannot resolve', () => {
    delete process.env.MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE;
    const { service } = serviceWith();

    // The resolver would otherwise fall back to an AWS host shape that does
    // not exist for this bucket, and Java would store that dead URL forever.
    expect(() => service.publicUrl(object)).toThrow(
      /MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE/,
    );
  });

  it('stores the canonical bytes the Build hashed', async () => {
    const { service, upload } = serviceWith();

    const placement = await service.upload(object, MANIFEST);

    expect(placement).toEqual({
      key: storyChapterManifestKey(object),
      url: `${PUBLIC_BASE_URL}/${storyChapterManifestKey(object)}`,
      manifestHash: MANIFEST_HASH,
    });
    const [call] = upload.mock.calls[0] as [
      { body: Buffer; key: string; contentType: string },
    ];
    expect(call.body.toString('utf8')).toBe(canonicalJsonString(MANIFEST));
    expect(canonicalJsonHash(MANIFEST)).toBe(object.runtimeHash);
  });

  it('refuses a manifest that does not belong to the key it is addressed by', async () => {
    const { service, upload } = serviceWith();

    await expect(
      service.upload({ ...object, runtimeHash: 'c'.repeat(64) }, MANIFEST),
    ).rejects.toThrow(/do not hash to the Build runtime hash/);
    expect(upload).not.toHaveBeenCalled();
  });
});
