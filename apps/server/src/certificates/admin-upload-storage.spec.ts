import { Prisma, type MediaAsset } from '@prisma/client';
import type { PrismaService } from '../infra/db/db.module';
import type { OutputStorageResult } from '../infra/storage/storage.types';
import { CertificatesService } from './certificates.service';
import { IpCommerceService } from '../ip-commerce/ip-commerce.service';
const placements: OutputStorageResult[] = [
  {
    provider: 'azure_blob',
    bucket: 'actual-azure',
    region: 'eastus2',
    storagePath: 'actual/key.png',
    bytes: 3,
    url: 'https://provider.invalid/private-sdk-url',
  },
  {
    provider: 'aliyun_oss',
    bucket: 'actual-oss',
    region: 'oss-cn-hangzhou',
    storagePath: 'actual/key.png',
    bytes: 3,
    url: 'https://provider.invalid/private-sdk-url',
  },
  {
    provider: 's3_compatible',
    bucket: 'actual-s3',
    region: null,
    storagePath: 'actual/key.png',
    bytes: 3,
    url: 'https://provider.invalid/private-sdk-url',
  },
];
function build(uploaded: OutputStorageResult) {
  const create = jest.fn((args: Prisma.MediaAssetCreateArgs) =>
    Promise.resolve({
      id: 'asset-id',
      externalUrl: null,
      deletedAt: null,
      moderationStatus: 'unreviewed',
      width: null,
      height: null,
      durationSeconds: null,
      ...args.data,
    } as MediaAsset),
  );
  const db = { mediaAsset: { create } } as unknown as PrismaService;
  const storage = { upload: jest.fn().mockResolvedValue(uploaded) };
  const certificates = new CertificatesService(
    db,
    { resolvePublicUrl: () => null } as unknown as ConstructorParameters<
      typeof CertificatesService
    >[1],
    storage as unknown as ConstructorParameters<typeof CertificatesService>[2],
  );
  const ips = new IpCommerceService(
    db,
    {} as ConstructorParameters<typeof IpCommerceService>[1],
    storage as unknown as ConstructorParameters<typeof IpCommerceService>[2],
    {} as ConstructorParameters<typeof IpCommerceService>[3],
    {} as ConstructorParameters<typeof IpCommerceService>[4],
    {} as ConstructorParameters<typeof IpCommerceService>[5],
    {} as ConstructorParameters<typeof IpCommerceService>[6],
  );
  const file = {
    buffer: Buffer.from('img'),
    size: 3,
    originalname: 'image.png',
    mimetype: 'image/png',
  };
  const perform = (kind: 'certificate' | 'discovery') =>
    kind === 'certificate'
      ? certificates.uploadAdminMedia(file)
      : ips.uploadAdminDiscoveryMedia('image', file);
  return { create, storage, perform };
}
describe.each(['certificate', 'discovery'] as const)(
  '%s upload storage identity',
  (kind) => {
    it.each(placements)(
      'records $provider placement returned by the selected storage implementation',
      async (placement) => {
        const t = build(placement);
        await t.perform(kind);
        expect(t.create).toHaveBeenCalledTimes(1);
        expect(t.create.mock.calls[0][0].data).toMatchObject({
          storageProvider: placement.provider,
          bucket: placement.bucket,
          region: placement.region,
          objectKey: placement.storagePath,
          sizeBytes: 3n,
        });
        expect(t.create.mock.calls[0][0].data.externalUrl).toBeUndefined();
        expect(t.storage.upload).toHaveBeenCalledTimes(1);
      },
    );
    it('does not create an asset after storage failure and permits a new upload attempt', async () => {
      const t = build(placements[2]);
      t.storage.upload.mockRejectedValueOnce(new Error('Storage unavailable'));
      await expect(t.perform(kind)).rejects.toMatchObject({ status: 503 });
      expect(t.create).not.toHaveBeenCalled();
      await t.perform(kind);
      expect(t.create).toHaveBeenCalledTimes(1);
    });
  },
);
