import { Module } from '@nestjs/common';
import { AiGenerationModule } from '../ai-generation/ai-generation.module';
import { StoryStudioModule } from '../story-studio/story-studio.module';
import { StoryProductionPlanModule } from '../story-studio/story-production-plan.module';
import {
  AppStoryAgentController,
  AppStoryEntryController,
} from './app-story-agent.controller';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AppStoryAgentService } from './app-story-agent.service';
import { AppStoryAgentWorker } from './app-story-agent.worker';
import { CopilotDocumentService } from '../copilot/copilot-document.service';
@Module({
  imports: [
    StoryStudioModule,
    StoryProductionPlanModule,
    AiGenerationModule,
    WorkspacesModule,
  ],
  controllers: [AppStoryAgentController, AppStoryEntryController],
  providers: [
    AppStoryAgentService,
    AppStoryAgentWorker,
    CopilotDocumentService,
  ],
})
export class AppStoryAgentModule {}
