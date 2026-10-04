import { DocumentsModule } from '../documents/documents.module';
import { RealtimeRevokeModule } from '../infra/realtime/realtime-revoke.module';
import { StoryProjectMoveController } from './story-project-move.controller';
import { StoryProjectMoveService } from './story-project-move.service';
import { Module } from '@nestjs/common';
import { StoryCommunityAccessService } from './story-community-access.service';
import { StoryCommunityAccessController } from './story-community-access.controller';
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
import { StoryPublicationController } from './story-publication.controller';
import { StoryPublicationService } from './story-publication.service';
import { StoryPublicationJavaService } from './story-publication-java.service';

@Module({
  imports: [
    DocumentsModule,
    RealtimeRevokeModule,
    WorkspacesModule,
    StoryAccessModule,
    StorageModule,
    MediaModule,
    StoryAgentRunModule,
  ],
  controllers: [
    StoryProjectMoveController,
    StoryCommunityAccessController,
    StoryProjectsController,
    StoryReferenceController,
    StoryBuildController,
    StoryWorkingPreviewController,
    StoryPublicationController,
  ],
  providers: [
    StoryProjectMoveService,
    StoryCommunityAccessService,
    StoryProjectsService,
    StoryReferenceService,
    StoryBuildService,
    StoryExperienceReleaseService,
    StoryChapterManifestStorageService,
    StoryWorkingPreviewService,
    StoryPublicationService,
    StoryPublicationJavaService,
  ],
  exports: [StoryProjectsService, StoryAccessModule, StoryAgentRunModule],
})
export class StoryStudioModule {}
