import { Module } from '@nestjs/common';
import { CURRENT_CELL } from '../../common/region/current-cell';
import { AzureBlobStorageService } from './azure-blob-storage.service';
import { AliyunOssStorageService } from './oss-storage.service';
import { MediaAssetUrlResolverService } from './media-asset-url-resolver.service';
import { MediaStorageAccessService } from './media-storage-access.service';
import { StorageProviderRegistry } from './storage-provider-registry.service';
import { OutputStorageService } from './storage.types';

/**
 * Storage provider selection, keyed on the deployment cell.
 *
 *   cn          → Alibaba OSS  (keep CN media in-region)
 *   com/global  → Azure Blob   (intl, matches the Azure migration; local
 *                               dev is `global` → Azure per the build env)
 *
 * Both impls are instantiated as Nest providers so the factory can pick;
 * only the chosen one is bound to the OutputStorageService token. Every
 * existing injection of OutputStorageService (AI-gen worker, certificates,
 * ip-commerce, /ready) resolves the same token — now region-correct — and
 * keeps working unchanged.
 *
 * Adding a provider later is ONE impl class + ONE factory branch:
 *   - add `S3StorageService` to `providers`
 *   - add `: cell === 'xx' ? s3` to the useFactory ternary
 * Nothing else moves. CURRENT_CELL is a module-eval constant so the
 * factory runs exactly once at boot — zero per-request cost.
 */
@Module({
  providers: [
    AzureBlobStorageService,
    AliyunOssStorageService,
    {
      provide: OutputStorageService,
      useFactory: (
        azure: AzureBlobStorageService,
        oss: AliyunOssStorageService,
      ) => (CURRENT_CELL === 'cn' ? oss : azure),
      inject: [AzureBlobStorageService, AliyunOssStorageService],
    },
    MediaAssetUrlResolverService,
    MediaStorageAccessService,
    StorageProviderRegistry,
  ],
  exports: [
    OutputStorageService,
    MediaAssetUrlResolverService,
    MediaStorageAccessService,
    StorageProviderRegistry,
  ],
})
export class StorageModule {}
