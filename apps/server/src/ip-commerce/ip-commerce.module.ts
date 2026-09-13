import { ConversationsModule } from '../conversations/conversations.module';
import { CrewAuthorizationService } from '../crews/crew-authorization.service';
import { IpCrewOriginService, IpCrewOriginController } from './ip-crew-origin';
import {
  IpReleaseLinksController,
  IpReleaseLinksService,
} from './ip-release-links';
import {
  IpCommentsController,
  IpCommentsAdminController,
} from './ip-comments.controller';
import { IpCommentsService } from './ip-comments.service';
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
    ConversationsModule,
    AdminAuthModule,
    StorageModule,
    WorkspacesModule,
    EntitlementsModule,
    LegacyMysqlModule,
  ],
  controllers: [
    IpCrewOriginController,
    IpReleaseLinksController,
    IpCommentsController,
    IpCommentsAdminController,
    IpCommerceController,
    IpCommerceAdminController,
    CreatorEarningsController,
  ],
  providers: [
    CrewAuthorizationService,
    IpCrewOriginService,
    IpReleaseLinksService,
    IpCommentsService,
    IpCommerceService,
    LegacyCnVideoResolverService,
    CreatorEarningsService,
  ],
  exports: [IpCommerceService],
})
export class IpCommerceModule {}
