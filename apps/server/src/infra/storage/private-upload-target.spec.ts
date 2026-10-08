import { AzureBlobStorageService } from './azure-blob-storage.service';
import { AliyunOssStorageService } from './oss-storage.service';
import { S3CompatibleStorageService } from './s3-storage.service';
import { requirePrivateUploadTarget } from './private-upload-target';

const settings = {
  AZURE_BLOB_CONNECTION_STRING: `DefaultEndpointsProtocol=https;AccountName=fixture;AccountKey=${Buffer.alloc(32, 1).toString('base64')};EndpointSuffix=core.windows.net`,
  AZURE_BLOB_CONTAINER: 'public-media',
  AZURE_BLOB_PRIVATE_CONTAINER: 'private-receipts',
  OSS_BUCKET: 'public-media',
  OSS_INTERNAL: 'false',
  OSS_PUBLIC_BASE_URL: '',
  OSS_PRIVATE_PUBLIC_BASE_URL: '',
  OSS_PRIVATE_BUCKET: 'private-receipts',
  OSS_REGION: 'oss-cn-hangzhou',
  OSS_ACCESS_KEY_ID: 'fixture-key',
  OSS_ACCESS_KEY_SECRET: 'fixture-secret',
  S3_ENDPOINT: 'https://fixture.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'public-media',
  S3_PRIVATE_BUCKET: 'private-receipts',
  S3_ACCESS_KEY_ID: 'fixture-key',
  S3_ACCESS_KEY_SECRET: 'fixture-secret',
  MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE: 'https://media.example.invalid',
  S3_FORCE_PATH_STYLE: 'true',
};
const input = {
  storageKey: 'receipts/staging/fixture.pdf',
  contentType: 'application/pdf',
  maxBytes: 1024,
};
describe('private upload destinations', () => {
  const previous = new Map(
    Object.keys(settings).map((key) => [key, process.env[key]]),
  );
  beforeEach(() => Object.assign(process.env, settings));
  afterEach(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  it('rejects missing, media and quarantine targets', () => {
    for (const target of ['', 'media', 'quarantine'])
      expect(() =>
        requirePrivateUploadTarget('PRIVATE_BUCKET', target, [
          'media',
          'quarantine',
        ]),
      ).toThrow('separate private upload destination');
  });
  it.each([
    [
      'azure',
      () => new AzureBlobStorageService(),
      'AZURE_BLOB_PRIVATE_CONTAINER',
    ],
    ['oss', () => new AliyunOssStorageService(), 'OSS_PRIVATE_BUCKET'],
    ['s3', () => new S3CompatibleStorageService(), 'S3_PRIVATE_BUCKET'],
  ] as const)(
    '%s signs directly into the configured private target without changing public uploads',
    async (_name, create, key) => {
      const service = create();
      const result = await service.createPrivateUploadUrl(input);
      expect(result.bucket).toBe('private-receipts');
      expect(result.url).toContain('private-receipts');
      expect(result.headers['Content-Type']).toBe('application/pdf');
      expect(result.storageKey).toBe(input.storageKey);
      expect((await service.createUploadUrl(input)).bucket).toBe(
        'public-media',
      );
      process.env[key] = '';
      await expect(create().createPrivateUploadUrl(input)).rejects.toThrow(
        'separate private upload destination',
      );
      process.env[key] = 'public-media';
      await expect(create().createPrivateUploadUrl(input)).rejects.toThrow(
        'separate private upload destination',
      );
    },
  );
  it('CN internal storage signs private uploads and downloads against a separate public CNAME', async () => {
    process.env.OSS_INTERNAL = 'true';
    process.env.OSS_PUBLIC_BASE_URL = 'https://media.example.invalid';
    process.env.OSS_PRIVATE_PUBLIC_BASE_URL = 'https://private.example.invalid';
    const service = new AliyunOssStorageService();
    const upload = await service.createPrivateUploadUrl(input);
    expect(new URL(upload.url).hostname).toBe('private.example.invalid');
    expect(upload.bucket).toBe('private-receipts');
    const read = await service.createReadUrl({
      bucket: upload.bucket,
      storageKey: input.storageKey,
      region: 'cn-hangzhou',
    });
    expect(new URL(read.url).hostname).toBe('private.example.invalid');
    expect(new URL((await service.createUploadUrl(input)).url).hostname).toBe(
      'media.example.invalid',
    );
  });
  it('never signs private CN uploads through the public media CNAME or internal endpoint', async () => {
    process.env.OSS_INTERNAL = 'true';
    process.env.OSS_PUBLIC_BASE_URL = 'https://media.example.invalid';
    await expect(
      new AliyunOssStorageService().createPrivateUploadUrl(input),
    ).rejects.toThrow('OSS_PRIVATE_PUBLIC_BASE_URL');
    process.env.OSS_PRIVATE_PUBLIC_BASE_URL = process.env.OSS_PUBLIC_BASE_URL;
    expect(() => new AliyunOssStorageService()).toThrow('separate HTTPS');
  });
});
