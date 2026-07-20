import { Module } from '@nestjs/common';
import { AiGenerationModule } from '../ai-generation/ai-generation.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { StorageModule } from '../infra/storage/storage.module';
import { MediaModule } from '../media/media.module';
import { StoryFilmBuildController } from './story-film-build.controller';
import { StoryFilmBuildService } from './story-film-build.service';
import { StoryExperienceReleaseGateway } from './story-experience-release.gateway';
import { StoryExperienceReleaseService } from './story-experience-release.service';
import { StoryExperienceReleaseWorkerService } from './story-experience-release-worker.service';
import { StoryFilmProductionController } from './story-film-production.controller';
import { StoryFilmProductionService } from './story-film-production.service';
import { StoryFilmReferenceController } from './story-film-reference.controller';
import { StoryFilmReferenceService } from './story-film-reference.service';
import { StoryFilmTrailerProductionController } from './story-film-trailer-production.controller';
import { StoryFilmTrailerProductionService } from './story-film-trailer-production.service';
import { StoryAccessModule } from './story-access.module';
import { StoryProjectVideoLibraryController } from './story-project-video-library.controller';
import { StoryProjectVideoLibraryService } from './story-project-video-library.service';
import { StoryProjectsController } from './story-projects.controller';
import { StoryProjectsService } from './story-projects.service';
import { StoryWorkingPreviewController } from './story-working-preview.controller';
import { StoryWorkingPreviewService } from './story-working-preview.service';
import { StoryVideoUploadFinalizeWorkerService } from './story-video-upload-finalize-worker.service';
import {
  StoryFfprobeRunner,
  StoryUploadedVideoProbeService,
} from './story-uploaded-video-probe.service';

@Module({
  imports: [
    WorkspacesModule,
    StoryAccessModule,
    AiGenerationModule,
    StorageModule,
    MediaModule,
  ],
  controllers: [
    StoryProjectsController,
    StoryProjectVideoLibraryController,
    StoryFilmProductionController,
    StoryFilmReferenceController,
    StoryFilmTrailerProductionController,
    StoryFilmBuildController,
    StoryWorkingPreviewController,
  ],
  providers: [
    StoryProjectsService,
    StoryProjectVideoLibraryService,
    StoryFfprobeRunner,
    StoryUploadedVideoProbeService,
    StoryVideoUploadFinalizeWorkerService,
    StoryFilmProductionService,
    StoryFilmReferenceService,
    StoryFilmTrailerProductionService,
    StoryFilmBuildService,
    StoryExperienceReleaseGateway,
    StoryExperienceReleaseService,
    StoryExperienceReleaseWorkerService,
    StoryWorkingPreviewService,
  ],
  exports: [StoryProjectsService, StoryAccessModule],
})
export class StoryStudioModule {}
