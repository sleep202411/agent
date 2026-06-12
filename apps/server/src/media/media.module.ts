import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { AuthModule } from '../auth';
import { StorageModule } from '../infra/storage/storage.module';
import { WorkspacesModule } from '../workspaces';
import { AdminMediaController } from './admin-media.controller';
import { AdminMediaService } from './admin-media.service';
import { CdnPurgeProvider } from './cdn-purge.provider';
import { CdnPurgeWorkerService } from './cdn-purge-worker.service';
import { MediaAccessController } from './media-access.controller';
import { MediaAccessService } from './media-access.service';
import { MediaProcessingService } from './media-processing.service';
import { MediaProcessingWorkerService } from './media-processing-worker.service';
import { MediaUploadController } from './media-upload.controller';
import { MediaUploadService } from './media-upload.service';

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
  imports: [AdminAuthModule, AuthModule, StorageModule, WorkspacesModule],
  controllers: [
    MediaUploadController,
    MediaAccessController,
    AdminMediaController,
  ],
  providers: [
    MediaUploadService,
    MediaAccessService,
    AdminMediaService,
    MediaProcessingService,
    MediaProcessingWorkerService,
    CdnPurgeProvider,
    CdnPurgeWorkerService,
  ],
  exports: [MediaUploadService, MediaAccessService, MediaProcessingService],
})
export class MediaModule {}
