import { AliyunOssStorageService } from './oss-storage.service';
import { AzureBlobStorageService } from './azure-blob-storage.service';
import { S3CompatibleStorageService } from './s3-storage.service';
import type { MultipartUploadRef } from './storage.types';

const environment = { ...process.env };
const ref: MultipartUploadRef = {
  storageKey: 'episode/video.mp4',
  uploadId: 'upload+id/with=symbols',
  bucket: 'test-media',
  region: 'cn-hangzhou',
};
afterEach(() => {
  process.env = { ...environment };
});

describe('multipart storage wire contracts', () => {
  function oss() {
    Object.assign(process.env, {
      OSS_BUCKET: ref.bucket,
      OSS_REGION: 'oss-cn-hangzhou',
      OSS_ACCESS_KEY_ID: 'test-access-key',
      OSS_ACCESS_KEY_SECRET: 'test-secret',
      OSS_INTERNAL: 'true',
      OSS_PUBLIC_BASE_URL: 'https://media.example.test',
    });
    return new AliyunOssStorageService();
  }

  it('OSS signs the public endpoint and encodes upload ID and part number', async () => {
    const signed = await oss().signUploadPart(ref, 1234);
    const url = new URL(signed.url);
    expect(url.hostname).toBe('media.example.test');
    expect(url.searchParams.get('uploadId')).toBe(ref.uploadId);
    expect(url.searchParams.get('partNumber')).toBe('1234');
    expect(url.searchParams.has('x-oss-signature')).toBe(true);
    expect(signed.headers).toEqual({});
  });

  it('OSS handles XML string values, singleton parts and pagination beyond 1000 parts', async () => {
    const service = oss();
    // Exercise the provider wrapper against the actual ali-oss XML result shape.
    const client = (
      service as unknown as {
        client: { listParts: (...args: unknown[]) => Promise<unknown> };
      }
    ).client;
    const list = jest
      .spyOn(client, 'listParts')
      .mockResolvedValueOnce({
        parts: { PartNumber: '1000', Size: '16777216', ETag: 'one' },
        isTruncated: 'true',
        nextPartNumberMarker: '1000',
      })
      .mockResolvedValueOnce({
        parts: [{ PartNumber: '1001', Size: '123', ETag: 'two' }],
        isTruncated: 'false',
      });
    expect(await service.listUploadParts(ref)).toEqual([
      { number: 1000, sizeBytes: 16777216, etag: 'one' },
      { number: 1001, sizeBytes: 123, etag: 'two' },
    ]);
    expect(list.mock.calls[1][2]).toMatchObject({
      'part-number-marker': 1000,
    });
  });

  it('R2 signs multipart identity without an SDK checksum of an empty body', async () => {
    Object.assign(process.env, {
      S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      S3_REGION: 'auto',
      S3_BUCKET: ref.bucket,
      S3_ACCESS_KEY_ID: 'test-access-key',
      S3_ACCESS_KEY_SECRET: 'test-secret',
      S3_FORCE_PATH_STYLE: 'true',
      MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE: 'https://media.example.test',
    });
    const signed = await new S3CompatibleStorageService().signUploadPart(
      ref,
      2240,
    );
    const url = new URL(signed.url);
    expect(url.searchParams.get('uploadId')).toBe(ref.uploadId);
    expect(url.searchParams.get('partNumber')).toBe('2240');
    expect(
      [...url.searchParams.keys()].filter((key) => key.includes('checksum')),
    ).toEqual([]);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('Azure uses isolated, fixed-width block IDs and write-only blob SAS', async () => {
    process.env.AZURE_BLOB_CONNECTION_STRING = `DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=${Buffer.alloc(32, 1).toString('base64')};EndpointSuffix=core.windows.net`;
    const service = new AzureBlobStorageService();
    const first = new URL((await service.signUploadPart(ref, 1)).url);
    const last = new URL((await service.signUploadPart(ref, 2240)).url);
    expect(first.searchParams.get('comp')).toBe('block');
    expect(first.searchParams.get('sp')).toBe('w');
    expect(first.searchParams.get('blockid')!.length).toBe(
      last.searchParams.get('blockid')!.length,
    );
    expect(
      Buffer.from(last.searchParams.get('blockid')!, 'base64').toString(),
    ).toBe(`${ref.uploadId}:002240`);
  });
});
