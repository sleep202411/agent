import { Module } from '@nestjs/common';
import { CrewRoleService } from '../crew-role.service';
import { CrewAssetAccessService } from './asset-access.service';

/**
 * Leaf authorization module shared by crew workflows and generic media URL
 * issuance. Keeping this separate prevents MediaModule from importing the
 * entire crew product module (controllers, workers and collaboration stack).
 */
@Module({
  providers: [CrewRoleService, CrewAssetAccessService],
  exports: [CrewRoleService, CrewAssetAccessService],
})
export class CrewAssetAccessModule {}
