import { Module } from '@nestjs/common';
import { StorageModule } from '../../../../infra/storage/storage.module';
import { BytePlusAssetsClient } from './byteplus-assets-client';
import { BytePlusAssetsConfigService } from './byteplus-assets-config.service';
import { CharacterProviderSyncService } from './character-provider-sync.service';

/**
 * ModelArk ASSETS plane (design §2.2): signed Action API client + the
 * dual-lane provider sync for character asset mirrors. Deliberately its own
 * module so the dependency points one way — CharactersModule imports this,
 * never the reverse — and the inference-side AiGenerationModule stays
 * decoupled from the likeness plane entirely.
 */
@Module({
  imports: [StorageModule],
  providers: [
    BytePlusAssetsConfigService,
    BytePlusAssetsClient,
    CharacterProviderSyncService,
  ],
  exports: [
    BytePlusAssetsConfigService,
    BytePlusAssetsClient,
    CharacterProviderSyncService,
  ],
})
export class BytePlusAssetsModule {}
