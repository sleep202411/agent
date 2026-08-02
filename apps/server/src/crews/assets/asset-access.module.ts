import { Module } from '@nestjs/common';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { CrewAssetAccessService } from './asset-access.service';

/**
 * Leaf authorization module shared by crew workflows and generic media URL
 * issuance. Keeping this separate prevents MediaModule from importing the
 * entire crew product module (controllers, workers and collaboration stack).
 */
@Module({
  providers: [CrewAuthorizationService, CrewAssetAccessService],
  exports: [CrewAuthorizationService, CrewAssetAccessService],
})
export class CrewAssetAccessModule {}
