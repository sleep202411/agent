import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import { MediaStorageProvider } from '@prisma/client';
import { UploadedImageProbeService } from './uploaded-image-probe.service';

// This suite supplies signed URLs directly; storage SDKs are outside its scope.
jest.mock('../infra/storage/media-storage-access.service', () => ({
  MediaStorageAccessService: class {},
}));

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const VALID_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAADAAIDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z',
  'base64',
);

function harness(bytes = VALID_PNG) {
  const storageAccess = {
    createReadUrl: jest.fn().mockResolvedValue({
      url: 'https://storage.example.test/reference-final',
      provider: 'azure_blob',
      bucket: 'media',
      objectKey: 'media/global/ai-reference-image-final/image.png',
      expiresAt: '2026-07-17T13:00:00.000Z',
    }),
  };
  const service = new UploadedImageProbeService(storageAccess as never);
  jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(bytes, {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength) },
    }),
  );
  return { service, storageAccess };
}

function asset(bytes = VALID_PNG) {
  return {
    storageProvider: MediaStorageProvider.azure_blob,
    bucket: 'media',
    region: 'eastus2',
    objectKey: 'media/global/ai-reference-image-final/image.png',
    externalUrl: null,
    contentType: 'image/png',
    sizeBytes: BigInt(bytes.byteLength),
  };
}

describe('UploadedImageProbeService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports inspector output exhaustion without declaring the image invalid', async () => {
    const { service } = harness();
    jest
      .spyOn(childProcess, 'execFile')
      .mockImplementation((...args: unknown[]) => {
        const callback = args.at(-1) as (
          error: unknown,
          stdout: string,
          stderr: string,
        ) => void;
        callback({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, '', '');
        return {} as childProcess.ChildProcess;
      });
    await expect(
      service.probe(asset(), {
        expectedContentType: 'image/png',
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'MEDIA_IMAGE_INSPECTOR_OUTPUT_LIMIT' },
    });
  });

  it.each([
    [503, null, 'MEDIA_IMAGE_STORAGE_UNAVAILABLE'],
    [200, '999', 'MEDIA_IMAGE_SIZE_MISMATCH'],
  ])(
    'releases rejected response streams (status %s, length %s)',
    async (status, length, code) => {
      const { service } = harness();
      const cancel = jest.fn();
      const body = new ReadableStream({ cancel });
      jest.mocked(global.fetch).mockResolvedValue(
        new Response(body, {
          status,
          headers: length ? { 'content-length': length } : {},
        }),
      );
      await expect(
        service.probe(asset(), {
          expectedContentType: 'image/png',
          maxBytes: 30 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({ response: { code } });
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves the storage error if response cleanup rejects', async () => {
    const { service } = harness();
    const cancel = jest.fn().mockRejectedValue(new Error('cleanup failed'));
    jest
      .mocked(global.fetch)
      .mockResolvedValue(
        new Response(new ReadableStream({ cancel }), { status: 503 }),
      );
    await expect(
      service.probe(asset(), {
        expectedContentType: 'image/png',
        maxBytes: 30 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_IMAGE_STORAGE_UNAVAILABLE' },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('streams and hashes exact final bytes, fully decodes them, and reports real dimensions', async () => {
    const { service, storageAccess } = harness();

    await expect(
      service.probe(asset(), {
        expectedContentType: 'image/png',
        maxBytes: 30 * 1024 * 1024,
      }),
    ).resolves.toEqual({
      checksumSha256: createHash('sha256').update(VALID_PNG).digest('hex'),
      sizeBytes: BigInt(VALID_PNG.byteLength),
      width: 1,
      height: 1,
      contentType: 'image/png',
      fileExtension: 'png',
    });
    expect(storageAccess.createReadUrl).toHaveBeenCalledWith(asset(), {
      expiresInSeconds: 600,
    });
  });

  it('rejects structurally plausible bytes whose compressed pixels do not decode', async () => {
    const corrupt = Buffer.from(VALID_PNG);
    const idat = corrupt.indexOf(Buffer.from('IDAT'));
    expect(idat).toBeGreaterThan(0);
    corrupt[idat + 5] ^= 0xff;
    const { service } = harness(corrupt);

    await expect(
      service.probe(asset(corrupt), {
        expectedContentType: 'image/png',
        maxBytes: 30 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_IMAGE_INVALID' },
    });
  });

  it('detects JPEG from bytes instead of trusting the supplied object suffix', async () => {
    const { service } = harness(VALID_JPEG);

    await expect(
      service.probe(asset(VALID_JPEG), {
        expectedContentType: 'image/jpeg',
        maxBytes: 30 * 1024 * 1024,
      }),
    ).resolves.toEqual({
      checksumSha256: createHash('sha256').update(VALID_JPEG).digest('hex'),
      sizeBytes: BigInt(VALID_JPEG.byteLength),
      width: 2,
      height: 3,
      contentType: 'image/jpeg',
      fileExtension: 'jpg',
    });
  });

  it('rejects a real format that differs from the issued MIME', async () => {
    const { service } = harness();

    await expect(
      service.probe(asset(), {
        expectedContentType: 'image/jpeg',
        maxBytes: 30 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_IMAGE_CONTENT_TYPE_MISMATCH' },
    });
  });

  it('rejects a final-object identity mismatch before downloading', async () => {
    const { service, storageAccess } = harness();
    storageAccess.createReadUrl.mockResolvedValue({
      url: 'https://storage.example.test/wrong',
      provider: 'azure_blob',
      bucket: 'media',
      objectKey: 'media/global/ai-reference-image-final/other.png',
      expiresAt: '2026-07-17T13:00:00.000Z',
    });

    await expect(
      service.probe(asset(), {
        expectedContentType: 'image/png',
        maxBytes: 30 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_IMAGE_STORAGE_IDENTITY_MISMATCH' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
