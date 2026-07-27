/**
 * Studio copilot module — fully decoupled from the StoryOS/Mastra assistant
 * stack (imports nothing from src/assistant). Auth is the global AuthGuard;
 * PostgreSQL is global. Project authorization is an explicit import because
 * every stream is scoped to a canvas or story project.
 */
import { Module } from '@nestjs/common';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { StoryAgentRunModule } from '../story-studio/story-agent-run.module';
import { WorkspacesModule } from '../workspaces';
import { CopilotConfigService } from './copilot.config';
import { CopilotController } from './copilot.controller';
import { CopilotDocumentService } from './copilot-document.service';
import { CopilotQuotaService } from './copilot-quota.service';
import { CopilotStore } from './copilot.store';

@Module({
  imports: [StoryAccessModule, StoryAgentRunModule, WorkspacesModule],
  controllers: [CopilotController],
  providers: [
    CopilotConfigService,
    CopilotStore,
    CopilotQuotaService,
    CopilotDocumentService,
  ],
})
export class CopilotModule {}
