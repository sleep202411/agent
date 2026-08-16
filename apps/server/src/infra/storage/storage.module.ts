import { Module } from '@nestjs/common';
import { CURRENT_CELL } from '../../common/region/current-cell';
import { AzureBlobStorageService } from './azure-blob-storage.service';
import { ImmTranscodeService } from './imm-transcode.service';
import { AliyunOssStorageService } from './oss-storage.service';
import { S3CompatibleStorageService } from './s3-storage.service';
import { MediaAssetUrlResolverService } from './media-asset-url-resolver.service';
import { MediaStorageAccessService } from './media-storage-access.service';
import { StorageProviderRegistry } from './storage-provider-registry.service';
import { OutputStorageService } from './storage.types';

/**
 * Storage provider selection: `OUTPUT_STORAGE_PROVIDER` env wins when set
 * (azure_blob | aliyun_oss | s3_compatible), otherwise keyed on the cell:
 *
 *   cn          → Alibaba OSS          (keep CN media in-region)
 *   com/global  → s3_compatible (R2)   (intl default; Azure Blob is legacy
 *                                       read-only for existing MediaAsset rows)
 *
 * Roll back new writes to Azure with `OUTPUT_STORAGE_PROVIDER=azure_blob`
 * without redeploying code.
 *
 * All impls are instantiated as Nest providers so the factory can pick;
 * only the chosen one is bound to the OutputStorageService token. Every
 * existing injection of OutputStorageService (AI-gen worker, certificates,
 * ip-commerce, /ready) resolves the same token and keeps working unchanged.
 * A single write path may override the token per unit of work by resolving
 * {@link StorageProviderRegistry} (e.g. AiJob.outputStorageProvider).
 * EXISTING rows are unaffected — reads resolve per-row via
 * `MediaAsset.storageProvider` (url-resolver / access service / registry),
 * which is what makes a gradual new-writes-only migration safe.
 * CURRENT_CELL and the env are read once at boot — zero per-request cost.
 */
@Module({
  providers: [
    AzureBlobStorageService,
    AliyunOssStorageService,
    S3CompatibleStorageService,
    {
      provide: OutputStorageService,
      useFactory: (
        azure: AzureBlobStorageService,
        oss: AliyunOssStorageService,
        s3: S3CompatibleStorageService,
      ) => {
        const override = (process.env.OUTPUT_STORAGE_PROVIDER ?? '').trim();
        if (override === 'azure_blob') return azure;
        if (override === 'aliyun_oss') return oss;
        if (override === 's3_compatible') {
          s3.assertConfigured('OUTPUT_STORAGE_PROVIDER=s3_compatible');
          return s3;
        }
        if (override) {
          throw new Error(
            `Unknown OUTPUT_STORAGE_PROVIDER "${override}" (expected azure_blob | aliyun_oss | s3_compatible)`,
          );
        }
        // cn stays OSS; every other cell (com / global / local) writes to R2.
        // Azure remains available for reads of legacy rows and for emergency
        // env override.
        if (CURRENT_CELL === 'cn') return oss;
        s3.assertConfigured(`${CURRENT_CELL} cell default output storage`);
        return s3;
      },
      inject: [
        AzureBlobStorageService,
        AliyunOssStorageService,
        S3CompatibleStorageService,
      ],
    },
    MediaAssetUrlResolverService,
    MediaStorageAccessService,
    StorageProviderRegistry,
    ImmTranscodeService,
  ],
  exports: [
    OutputStorageService,
    MediaAssetUrlResolverService,
    MediaStorageAccessService,
    StorageProviderRegistry,
    ImmTranscodeService,
  ],
})
export class StorageModule {}
