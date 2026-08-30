import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { StorageModule } from '../infra/storage/storage.module';
import { MediaModule } from '../media/media.module';
import { StoryBuildController } from './story-build.controller';
import { StoryBuildService } from './story-build.service';
import { StoryExperienceReleaseService } from './story-experience-release.service';
import { StoryChapterManifestStorageService } from './story-chapter-manifest-storage.service';
import { StoryReferenceController } from './story-reference.controller';
import { StoryReferenceService } from './story-reference.service';
import { StoryAccessModule } from './story-access.module';
import { StoryProjectsController } from './story-projects.controller';
import { StoryProjectsService } from './story-projects.service';
import { StoryWorkingPreviewController } from './story-working-preview.controller';
import { StoryWorkingPreviewService } from './story-working-preview.service';
import { StoryAgentRunModule } from './story-agent-run.module';

@Module({
  imports: [
    WorkspacesModule,
    StoryAccessModule,
    StorageModule,
    MediaModule,
    StoryAgentRunModule,
  ],
  controllers: [
    StoryProjectsController,
    StoryReferenceController,
    StoryBuildController,
    StoryWorkingPreviewController,
  ],
  providers: [
    StoryProjectsService,
    StoryReferenceService,
    StoryBuildService,
    StoryExperienceReleaseService,
    StoryChapterManifestStorageService,
    StoryWorkingPreviewService,
  ],
  exports: [StoryProjectsService, StoryAccessModule, StoryAgentRunModule],
})
export class StoryStudioModule {}
