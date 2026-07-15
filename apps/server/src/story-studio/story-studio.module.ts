import { Module } from '@nestjs/common';
import { AiGenerationModule } from '../ai-generation/ai-generation.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { StorageModule } from '../infra/storage/storage.module';
import { StoryFilmBuildController } from './story-film-build.controller';
import { StoryFilmBuildService } from './story-film-build.service';
import { StoryFilmProductionController } from './story-film-production.controller';
import { StoryFilmProductionService } from './story-film-production.service';
import { StoryFilmReferenceController } from './story-film-reference.controller';
import { StoryFilmReferenceService } from './story-film-reference.service';
import { StoryFilmTrailerProductionController } from './story-film-trailer-production.controller';
import { StoryFilmTrailerProductionService } from './story-film-trailer-production.service';
import { StoryPermissionService } from './story-permission.service';
import { StoryProjectVideoLibraryController } from './story-project-video-library.controller';
import { StoryProjectVideoLibraryService } from './story-project-video-library.service';
import { StoryProjectsController } from './story-projects.controller';
import { StoryProjectsService } from './story-projects.service';
import { StoryWorkingPreviewController } from './story-working-preview.controller';
import { StoryWorkingPreviewService } from './story-working-preview.service';

@Module({
  imports: [WorkspacesModule, AiGenerationModule, StorageModule],
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
    StoryFilmProductionService,
    StoryFilmReferenceService,
    StoryFilmTrailerProductionService,
    StoryFilmBuildService,
    StoryWorkingPreviewService,
    StoryPermissionService,
  ],
  exports: [StoryProjectsService, StoryPermissionService],
})
export class StoryStudioModule {}
