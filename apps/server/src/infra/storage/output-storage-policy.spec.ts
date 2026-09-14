import { outputStorageProviderForCell } from './output-storage-policy';
import { AliyunOssStorageService } from './oss-storage.service';
import { S3CompatibleStorageService } from './s3-storage.service';
import { StorageModule } from './storage.module';
import { OutputStorageService } from './storage.types';
import { MediaAssetUrlResolverService } from './media-asset-url-resolver.service';
import { StoryChapterManifestStorageService } from '../../story-studio/story-chapter-manifest-storage.service';
import { canonicalJsonHash } from '../../story-studio/canonical-json';

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

function cnStorage() {
  for (const key of Object.keys(process.env))
    if (key.startsWith('S3_') || key === 'MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE')
      delete process.env[key];
  Object.assign(process.env, {
    OSS_BUCKET: 'cn-media',
    OSS_REGION: 'oss-cn-hangzhou',
    OSS_ACCESS_KEY_ID: 'local-test',
    OSS_ACCESS_KEY_SECRET: 'local-test-secret',
    OSS_PUBLIC_BASE_URL: 'https://oss.example.test',
    MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS: 'https://media.example.test',
  });
  return new AliyunOssStorageService();
}

describe('one storage policy for the cell', () => {
  it('keeps CN on OSS and rejects conflicting overrides', () => {
    expect(outputStorageProviderForCell('cn')).toBe('aliyun_oss');
    expect(outputStorageProviderForCell('cn', 'aliyun_oss')).toBe('aliyun_oss');
    expect(() => outputStorageProviderForCell('cn', 's3_compatible')).toThrow(
      /CN cell/,
    );
    expect(outputStorageProviderForCell('global')).toBe('s3_compatible');
    expect(() => outputStorageProviderForCell('global', 'unknown')).toThrow(
      /Unknown/,
    );
  });

  it('requires all CN write/public URL configuration without requiring unused S3', () => {
    expect(() => cnStorage().assertConfigured('cn')).not.toThrow();
    delete process.env.OSS_ACCESS_KEY_SECRET;
    delete process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
    expect(() => new AliyunOssStorageService().assertConfigured('cn')).toThrow(
      /OSS_ACCESS_KEY_SECRET.*MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS/,
    );
    expect(() =>
      new S3CompatibleStorageService().assertConfigured('global'),
    ).toThrow(/S3_/);
  });

  it('validates the selected provider in the actual Nest factory', () => {
    const providers = Reflect.getMetadata('providers', StorageModule) as Array<{
      provide?: unknown;
      useFactory?: (...args: unknown[]) => unknown;
    }>;
    const factory = providers.find(
      (p) => p.provide === OutputStorageService,
    )!.useFactory!;
    const unused = { assertConfigured: jest.fn() };
    const selected = {
      assertConfigured: jest.fn(() => {
        throw new Error('missing required storage');
      }),
    };
    expect(() => factory(unused, unused, selected)).toThrow(
      'missing required storage',
    );
    expect(unused.assertConfigured).not.toHaveBeenCalled();
  });

  it('uploads and resolves CN chapter manifests through OSS with no S3 configuration', async () => {
    const storage = cnStorage();
    const upload = jest
      .spyOn(storage, 'upload')
      .mockImplementation(({ key, body }) =>
        Promise.resolve({
          provider: 'aliyun_oss',
          bucket: 'cn-media',
          region: 'cn-hangzhou',
          storagePath: key,
          bytes: body.length,
          url: 'https://internal.example.test',
        }),
      );
    const service = new StoryChapterManifestStorageService(
      storage,
      new MediaAssetUrlResolverService(),
    );
    const manifest = { manifestType: 'fizzdragon.experience', version: 1 };
    const object = {
      projectId: 'project',
      buildId: 'build',
      runtimeHash: canonicalJsonHash(manifest),
    };
    const result = await service.upload(object, manifest as never);
    expect(result.url).toBe(
      `https://media.example.test/story-chapters/project/build/${object.runtimeHash}.json`,
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(storage.objectLocation('video.mp4').storageProvider).toBe(
      'aliyun_oss',
    );
  });
});
