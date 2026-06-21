import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { StorageModule } from '../infra/storage/storage.module';
import { WorkspacesModule } from '../workspaces';
import { IpCommerceAdminController } from './ip-commerce-admin.controller';
import { IpCommerceController } from './ip-commerce.controller';
import { IpCommerceService } from './ip-commerce.service';
import { LegacyCnVideoResolverService } from './legacy-cn-video.service';

@Module({
  imports: [AdminAuthModule, StorageModule, WorkspacesModule],
  controllers: [IpCommerceController, IpCommerceAdminController],
  providers: [IpCommerceService, LegacyCnVideoResolverService],
  exports: [IpCommerceService],
})
export class IpCommerceModule {}
