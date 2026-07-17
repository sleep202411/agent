import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { BytePlusAssetsModule } from '../ai-generation/providers/byteplus/assets/byteplus-assets.module';
import { AuthModule } from '../auth';
import { StorageModule } from '../infra/storage/storage.module';
import { WorkspacesModule } from '../workspaces';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { AdminMediaController } from './admin-media.controller';
import { AdminMediaService } from './admin-media.service';
import { CdnPurgeProvider } from './cdn-purge.provider';
import { CdnPurgeWorkerService } from './cdn-purge-worker.service';
import { MediaTakedownWorkerService } from './media-takedown-worker.service';
import { MediaAccessController } from './media-access.controller';
import { MediaAccessService } from './media-access.service';
import { MediaModerationAdminService } from './media-moderation-admin.service';
import { MediaProcessingService } from './media-processing.service';
import { MediaProcessingWorkerService } from './media-processing-worker.service';
import { MediaUploadController } from './media-upload.controller';
import { MediaUploadService } from './media-upload.service';
import { StoryVideoUploadSessionService } from './story-video-upload-session.service';

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
    BytePlusAssetsModule,
  ],
  controllers: [
    MediaUploadController,
    MediaAccessController,
    AdminMediaController,
  ],
  providers: [
    MediaUploadService,
    StoryVideoUploadSessionService,
    MediaAccessService,
    AdminMediaService,
    MediaModerationAdminService,
    MediaProcessingService,
    MediaProcessingWorkerService,
    CdnPurgeProvider,
    CdnPurgeWorkerService,
    MediaTakedownWorkerService,
  ],
  exports: [
    MediaUploadService,
    MediaAccessService,
    MediaModerationAdminService,
    MediaProcessingService,
  ],
})
export class MediaModule {}
