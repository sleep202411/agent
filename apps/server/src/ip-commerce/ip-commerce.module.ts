import {
  ChannelVideosController,
  ChannelVideosService,
} from './channel-videos';
import { IpStudiosService, IpStudiosController } from './ip-studios';
import { CreatorServicesModule } from '../creator-services/creator-services.module';
import { ContentGpsGeocodingService } from './content-gps-geocoding';
import {
  ContentGpsSearchController,
  ContentGpsSearchService,
} from './content-gps-search';
import {
  ContentGpsDispatchService,
  ContentGpsDispatchController,
} from './content-gps-dispatch';
import { ContentGpsSourcesService } from './content-gps-sources';
import {
  ContentGpsAnalysisService,
  ContentGpsSuggestionsController,
} from './content-gps-analysis';
import {
  ContentGpsLocationsController,
  ContentGpsLocationsService,
} from './content-gps-locations';
import { ChannelSubmissionsAdminController } from './channel-submissions-admin.controller';
import {
  ChannelSubmissionsService,
  ChannelSubmissionsController,
} from './channel-submissions';
import {
  IpGameAssociationController,
  IpGameAssociationService,
} from './ip-game-associations';
import { ViewerAssistanceController } from './viewer-assistance.controller';
import {
  IpStageApplicationsService,
  IpStageApplicationsController,
  IpStageApplicationsAdminController,
} from './ip-stage-applications';
import { CreatorTrustController } from './creator-trust.controller';
import { IpProductionEvidenceController } from './ip-production-evidence';
import { IpProductionStageController } from './ip-production-stage';
import { IpProductionPublicController } from './ip-production-public';
import {
  IpEpisodeFeedbackController,
  IpEpisodeFeedbackService,
} from './ip-episode-feedback';
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
import {
  IpKnowledgeController,
  IpKnowledgeService,
} from './ip-knowledge.controller';
import { IpGenerationTemplatesController } from './ip-generation-templates.controller';
import { IpGenerationJobsController } from './ip-generation-jobs.controller';
import { IpGenerationJobsService } from './ip-generation-jobs.service';
import { IpGenerationTemplatesService } from './ip-generation-templates.service';
import { AiGenerationModule } from '../ai-generation/ai-generation.module';
import { IpCommerceService } from './ip-commerce.service';
import { IpPublishersService } from './ip-publishers.service';
import { LegacyCnVideoResolverService } from './legacy-cn-video.service';

@Module({
  imports: [
    CreatorServicesModule,
    ConversationsModule,
    AdminAuthModule,
    StorageModule,
    WorkspacesModule,
    EntitlementsModule,
    LegacyMysqlModule,
    AiGenerationModule,
  ],
  controllers: [
    ChannelVideosController,
    IpStudiosController,
    ContentGpsSearchController,
    ContentGpsSuggestionsController,
    ContentGpsDispatchController,
    ContentGpsLocationsController,
    ChannelSubmissionsAdminController,
    ChannelSubmissionsController,
    IpGameAssociationController,
    ViewerAssistanceController,
    IpStageApplicationsController,
    IpStageApplicationsAdminController,
    IpProductionPublicController,
    IpProductionStageController,
    IpProductionEvidenceController,
    IpCrewOriginController,
    IpReleaseLinksController,
    IpCommentsController,
    IpEpisodeFeedbackController,
    IpCommentsAdminController,
    IpCommerceController,
    IpKnowledgeController,
    IpGenerationTemplatesController,
    IpGenerationJobsController,
    IpCommerceAdminController,
    CreatorEarningsController,
    CreatorTrustController,
  ],
  providers: [
    ChannelVideosService,
    IpStudiosService,
    ContentGpsSearchService,
    ContentGpsGeocodingService,
    ContentGpsDispatchService,
    ContentGpsSourcesService,
    ContentGpsAnalysisService,
    ContentGpsLocationsService,
    ChannelSubmissionsService,
    IpGameAssociationService,
    IpStageApplicationsService,
    CrewAuthorizationService,
    IpCrewOriginService,
    IpReleaseLinksService,
    IpCommentsService,
    IpEpisodeFeedbackService,
    IpCommerceService,
    IpPublishersService,
    IpKnowledgeService,
    IpGenerationTemplatesService,
    IpGenerationJobsService,
    LegacyCnVideoResolverService,
    CreatorEarningsService,
  ],
  exports: [
    ContentGpsSearchService,
    IpCommerceService,
    IpGenerationTemplatesService,
    IpKnowledgeService,
  ],
})
export class IpCommerceModule {}
