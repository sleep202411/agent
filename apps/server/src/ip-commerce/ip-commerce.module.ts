import { CreatorEarningsController } from '../creator-earnings/creator-earnings.controller';
import { CreatorEarningsService } from '../creator-earnings/creator-earnings.service';
import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { EntitlementsModule } from '../entitlements';
import { LegacyMysqlModule } from '../infra/legacy-mysql';
import { StorageModule } from '../infra/storage/storage.module';
import { WorkspacesModule } from '../workspaces';
import { IpCommerceAdminController } from './ip-commerce-admin.controller';
import { IpCommerceController } from './ip-commerce.controller';
import { IpCommerceService } from './ip-commerce.service';
import { LegacyCnVideoResolverService } from './legacy-cn-video.service';

@Module({
  imports: [
    AdminAuthModule,
    StorageModule,
    WorkspacesModule,
    EntitlementsModule,
    LegacyMysqlModule,
  ],
  controllers: [
    IpCommerceController,
    IpCommerceAdminController,
    CreatorEarningsController,
  ],
  providers: [
    IpCommerceService,
    LegacyCnVideoResolverService,
    CreatorEarningsService,
  ],
  exports: [IpCommerceService],
})
export class IpCommerceModule {}
