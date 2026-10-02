import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { BytePlusAssetsModule } from '../ai-generation/providers/byteplus/assets/byteplus-assets.module';
import { SeedanceMediaAssetReadinessAdapter } from '../ai-generation/providers/byteplus/assets/seedance-media-asset-readiness.adapter';
import { AuthModule } from '../auth';
import { StorageModule } from '../infra/storage/storage.module';
import { WorkspacesModule } from '../workspaces';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { CrewAssetAccessModule } from '../crews/assets/asset-access.module';
import { DocumentsModule } from '../documents/documents.module';
import { AdminMediaController } from './admin-media.controller';
import { AdminMediaService } from './admin-media.service';
import { CdnPurgeProvider } from './cdn-purge.provider';
import { CdnPurgeWorkerService } from './cdn-purge-worker.service';
import { MediaTakedownWorkerService } from './media-takedown-worker.service';
import { MediaAccessController } from './media-access.controller';
import { MediaAccessService } from './media-access.service';
import { MediaAssetReadinessService } from './media-asset-readiness.service';
import { MEDIA_ASSET_READINESS_ADAPTERS } from './media-asset-readiness.port';
import { MediaModerationAdminService } from './media-moderation-admin.service';
import { MediaProcessingService } from './media-processing.service';
import { MediaProcessingWorkerService } from './media-processing-worker.service';
import { MediaUploadController } from './media-upload.controller';
import { MediaAssetFactsService } from './media-asset-facts.service';
import { MediaUploadService } from './media-upload.service';
import { EpisodeUploadController } from './episode-upload.controller';
import { EpisodeUploadService } from './episode-upload.service';
import { ContentReviewBillingController } from './content-review-billing.controller';
import { ContentReviewBillingService } from './content-review-billing.service';
import { ContentReviewRecordsController } from './content-review-records.controller';
import { ContentReviewRecordsService } from './content-review-records.service';
import { PlayableVideoProbeService } from './playable-video-probe.service';
import { PlayableAudioProbeService } from './playable-audio-probe.service';
import { UploadedImageProbeService } from './uploaded-image-probe.service';
import { VideoPosterService } from './video-poster.service';

/**
 * Media domain — direct-to-storage upload URL issuance.
 *
 * Imports StorageModule for the region-selected OutputStorageService
 * (Azure/OSS). PrismaService comes from the global DbModule. AuthModule
 * supplies the identity the global AuthGuard attaches before the
 * controller runs.
 *
 * Read-side URL materialization is NOT here — that's
 * MediaAssetUrlResolverService (already exported by StorageModule), and
 * read-side paywall/entitlement gating is a separate concern out of this
 * module's scope.
 */
@Module({
  imports: [
    AdminAuthModule,
    AuthModule,
    StorageModule,
    WorkspacesModule,
    StoryAccessModule,
    CrewAssetAccessModule,
    BytePlusAssetsModule,
    DocumentsModule,
  ],
  controllers: [
    EpisodeUploadController,
    ContentReviewBillingController,
    ContentReviewRecordsController,
    MediaUploadController,
    MediaAccessController,
    AdminMediaController,
  ],
  providers: [
    EpisodeUploadService,
    ContentReviewBillingService,
    ContentReviewRecordsService,
    MediaUploadService,
    MediaAssetFactsService,
    MediaAssetReadinessService,
    {
      provide: MEDIA_ASSET_READINESS_ADAPTERS,
      inject: [SeedanceMediaAssetReadinessAdapter],
      useFactory: (
        seedance: SeedanceMediaAssetReadinessAdapter,
      ): SeedanceMediaAssetReadinessAdapter[] => [seedance],
    },
    PlayableVideoProbeService,
    PlayableAudioProbeService,
    UploadedImageProbeService,
    MediaAccessService,
    AdminMediaService,
    MediaModerationAdminService,
    MediaProcessingService,
    MediaProcessingWorkerService,
    VideoPosterService,
    CdnPurgeProvider,
    CdnPurgeWorkerService,
    MediaTakedownWorkerService,
  ],
  exports: [
    MediaUploadService,
    MediaAssetFactsService,
    MediaAssetReadinessService,
    PlayableVideoProbeService,
    PlayableAudioProbeService,
    MediaAccessService,
    MediaModerationAdminService,
    MediaProcessingService,
    CdnPurgeProvider,
  ],
})
export class MediaModule {}
