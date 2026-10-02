import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../../admin-auth';
import { StorageModule } from '../../infra/storage/storage.module';
import { MediaModule } from '../../media/media.module';
import { StoryPlaybackAdminController } from './story-playback-admin.controller';
import { StoryPlaybackAdminService } from './story-playback-admin.service';
import { StoryPlaybackReconcileService } from './story-playback-reconcile.service';

/**
 * .cn interactive-film HLS distribution: the reconcile loop that keeps IMM
 * output equal to the live player catalogue, and its admin surface. The loop
 * and the boot-time config assertion only run where the
 * `adaptiveStoryPlayback` feature is on; elsewhere the module is inert and
 * its endpoints answer 404.
 */
@Module({
  imports: [StorageModule, MediaModule, AdminAuthModule],
  controllers: [StoryPlaybackAdminController],
  providers: [StoryPlaybackReconcileService, StoryPlaybackAdminService],
})
export class StoryPlaybackModule {}
