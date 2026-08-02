/**
 * Pins the wire shape of the presigned URLs this service mints — the part R2
 * validates and silently rejects (SignatureDoesNotMatch / 400 checksum) with no
 * hint about which input broke it. Signing is offline: getSignedUrl never
 * issues a request, so throwaway credentials produce the real URL.
 */
import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { S3CompatibleStorageService } from './s3-storage.service';

const R2_HOST = 'c378107772065c0671dc6b2a00c06412.r2.cloudflarestorage.com';

const R2_ENV: Record<string, string> = {
  S3_ENDPOINT: `https://${R2_HOST}`,
  S3_REGION: 'auto',
  S3_BUCKET: 'fizzdragon-media',
  S3_ACCESS_KEY_ID: 'access-key-id-example',
  S3_ACCESS_KEY_SECRET: 'access-key-secret-example',
  S3_FORCE_PATH_STYLE: 'true',
};

/** Env is read in the constructor, so it only has to hold for the `new`. */
function buildService(
  overrides: Record<string, string | undefined> = {},
): S3CompatibleStorageService {
  const saved = new Map(
    [...Object.keys(R2_ENV), ...Object.keys(overrides)].map((key) => [
      key,
      process.env[key],
    ]),
  );
  Object.assign(process.env, R2_ENV);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return new S3CompatibleStorageService();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const checksumParams = (url: URL): string[] =>
  [...url.searchParams.keys()].filter((key) =>
    key.toLowerCase().includes('checksum'),
  );

describe(S3CompatibleStorageService.name, () => {
  it('signs upload PUTs over host + content-type and nothing else', async () => {
    const result = await buildService().createUploadUrl({
      storageKey: 'staging/clip.mp4',
      contentType: 'video/mp4',
      maxBytes: 1024,
    });

    const url = new URL(result.url);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-type;host',
    );
    expect(result.headers).toEqual({ 'Content-Type': 'video/mp4' });
    expect(result.method).toBe('PUT');
  });

  it('keeps the SDK checksum pins out of the presigned PUT', async () => {
    const result = await buildService().createUploadUrl({
      storageKey: 'staging/clip.mp4',
      contentType: 'video/mp4',
      maxBytes: 1024,
    });

    // A checksum computed at signing time is a checksum of zero bytes: it can
    // never match the uploaded object, and being in the query it is signed and
    // undroppable by the uploader.
    expect(checksumParams(new URL(result.url))).toEqual([]);
  });

  it('signs read GETs over host only, with no checksum mode', async () => {
    const result = await buildService().createReadUrl({
      bucket: 'fizzdragon-media',
      storageKey: 'final/clip.mp4',
      contentType: 'video/mp4',
      filename: 'clip.mp4',
    });

    const url = new URL(result.url);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(checksumParams(url)).toEqual([]);
    expect(url.searchParams.get('response-content-type')).toBe('video/mp4');
  });

  it('signs in S3_REGION and addresses path-style when asked', async () => {
    const result = await buildService().createUploadUrl({
      storageKey: 'staging/clip.mp4',
      contentType: 'video/mp4',
      maxBytes: 1024,
    });

    const url = new URL(result.url);
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(
      /\/auto\/s3\/aws4_request$/,
    );
    expect(url.host).toBe(R2_HOST);
    expect(url.pathname).toBe('/fizzdragon-media/staging/clip.mp4');
    expect(result.region).toBe('auto');
  });

  it('falls back to virtual-hosted addressing without S3_FORCE_PATH_STYLE', async () => {
    const result = await buildService({
      S3_FORCE_PATH_STYLE: undefined,
    }).createUploadUrl({
      storageKey: 'staging/clip.mp4',
      contentType: 'video/mp4',
      maxBytes: 1024,
    });

    const url = new URL(result.url);
    expect(url.host).toBe(`fizzdragon-media.${R2_HOST}`);
    expect(url.pathname).toBe('/staging/clip.mp4');
  });

  it('bootstraps a missing local bucket once', async () => {
    const service = buildService({
      S3_AUTO_CREATE_BUCKET: 'true',
    });
    const send = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('bucket missing'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        }),
      )
      .mockResolvedValue(undefined);
    Object.defineProperty(service, 'client', { value: { send } });

    await expect(service.isHealthy()).resolves.toBe(true);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadBucketCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CreateBucketCommand);

    await expect(service.isHealthy()).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(HeadBucketCommand);
  });

  it('refuses local bucket auto-creation in production', () => {
    expect(() =>
      buildService({
        NODE_ENV: 'production',
        S3_AUTO_CREATE_BUCKET: 'true',
      }),
    ).toThrow(/must not be enabled in production/);
  });
});
