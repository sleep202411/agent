import { Module } from '@nestjs/common';
import { AzureBlobStorageService } from './azure-blob-storage.service';
import { MediaAssetUrlResolverService } from './media-asset-url-resolver.service';
import { OutputStorageService } from './storage.types';

@Module({
  providers: [
    // Single Azure Blob impl today. When CN gets an Alibaba OSS impl,
    // swap based on env (STORAGE_KIND=azure-blob|alibaba-oss) by
    // factory'ing the right class into the OutputStorageService token.
    { provide: OutputStorageService, useClass: AzureBlobStorageService },
    MediaAssetUrlResolverService,
  ],
  exports: [OutputStorageService, MediaAssetUrlResolverService],
})
export class StorageModule {}
