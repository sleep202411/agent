import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { StorageModule } from '../infra/storage/storage.module';
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
  imports: [AuthModule, StorageModule],
  controllers: [MediaUploadController],
  providers: [MediaUploadService],
  exports: [MediaUploadService],
})
export class MediaModule {}
