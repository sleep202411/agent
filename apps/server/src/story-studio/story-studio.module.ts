import { Module } from '@nestjs/common';
import { AiGenerationModule } from '../ai-generation/ai-generation.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { StorageModule } from '../infra/storage/storage.module';
import { MediaModule } from '../media/media.module';
import { StoryBuildController } from './story-build.controller';
import { StoryBuildService } from './story-build.service';
import { StoryExperienceReleaseGateway } from './story-experience-release.gateway';
import { StoryExperienceReleaseService } from './story-experience-release.service';
import { StoryExperienceReleaseWorkerService } from './story-experience-release-worker.service';
import { StoryVideoProductionController } from './story-video-production.controller';
import { StoryVideoProductionService } from './story-video-production.service';
import { StoryReferenceController } from './story-reference.controller';
import { StoryReferenceService } from './story-reference.service';
import { StoryTrailerProductionController } from './story-trailer-production.controller';
import { StoryTrailerProductionService } from './story-trailer-production.service';
import { StoryAccessModule } from './story-access.module';
import { StoryProjectVideoLibraryController } from './story-project-video-library.controller';
import { StoryProjectVideoLibraryService } from './story-project-video-library.service';
import { StoryProjectsController } from './story-projects.controller';
import { StoryProjectsService } from './story-projects.service';
import { StoryWorkingPreviewController } from './story-working-preview.controller';
import { StoryTextPlayController } from './story-text-play.controller';
import { StoryTextPlayService } from './story-text-play.service';
import { StoryWorkingPreviewService } from './story-working-preview.service';
import { StoryVideoUploadFinalizeWorkerService } from './story-video-upload-finalize-worker.service';
import { StoryUploadedVideoProbeService } from './story-uploaded-video-probe.service';
import { StoryAgentRunModule } from './story-agent-run.module';

@Module({
  imports: [
    WorkspacesModule,
    StoryAccessModule,
    AiGenerationModule,
    StorageModule,
    MediaModule,
    StoryAgentRunModule,
  ],
  controllers: [
    StoryProjectsController,
    StoryProjectVideoLibraryController,
    StoryVideoProductionController,
    StoryReferenceController,
    StoryTrailerProductionController,
    StoryBuildController,
    StoryWorkingPreviewController,
    StoryTextPlayController,
  ],
  providers: [
    StoryProjectsService,
    StoryProjectVideoLibraryService,
    StoryUploadedVideoProbeService,
    StoryVideoUploadFinalizeWorkerService,
    StoryVideoProductionService,
    StoryReferenceService,
    StoryTrailerProductionService,
    StoryBuildService,
    StoryExperienceReleaseGateway,
    StoryExperienceReleaseService,
    StoryExperienceReleaseWorkerService,
    StoryWorkingPreviewService,
    StoryTextPlayService,
  ],
  exports: [StoryProjectsService, StoryAccessModule, StoryAgentRunModule],
})
export class StoryStudioModule {}
