import { Module } from '@nestjs/common';
import { StorageModule } from '../../../../infra/storage/storage.module';
import { BytePlusAssetsClient } from './byteplus-assets-client';
import { BytePlusAssetsConfigService } from './byteplus-assets-config.service';
import { CharacterProviderSyncService } from './character-provider-sync.service';
import { MediaAssetProviderSyncService } from './media-asset-provider-sync.service';
import { SeedanceMediaAssetReadinessAdapter } from './seedance-media-asset-readiness.adapter';

/**
 * ModelArk ASSETS plane: signed Action API client plus provider sync for
 * character mirrors and plain MediaAsset mirrors. Deliberately its own module
 * so feature modules consume the assets plane without the assets plane knowing
 * about characters, media uploads, or inference workers.
 */
@Module({
  imports: [StorageModule],
  providers: [
    BytePlusAssetsConfigService,
    BytePlusAssetsClient,
    CharacterProviderSyncService,
    MediaAssetProviderSyncService,
    SeedanceMediaAssetReadinessAdapter,
  ],
  exports: [
    BytePlusAssetsConfigService,
    BytePlusAssetsClient,
    CharacterProviderSyncService,
    MediaAssetProviderSyncService,
    SeedanceMediaAssetReadinessAdapter,
  ],
})
export class BytePlusAssetsModule {}
