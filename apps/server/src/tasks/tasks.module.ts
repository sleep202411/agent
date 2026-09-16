import { Module } from '@nestjs/common';
import { AiGenerationModule } from '../ai-generation/ai-generation.module';
import { AgentOsProjectContextService } from '../agent-os-gateway/agent-os-project-context.service';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';

// Reuse project authorization without activating the optional Agent OS gateway.
@Module({
  imports: [AiGenerationModule, StoryAccessModule, WorkspacesModule],
  controllers: [TasksController],
  providers: [TasksService, AgentOsProjectContextService],
})
export class TasksModule {}
