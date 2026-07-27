import { Module } from '@nestjs/common';
import { RealtimeModule } from '../infra/realtime/realtime.module';
import { StoryAccessModule } from './story-access.module';
import { StoryAgentRunController } from './story-agent-run.controller';
import { StoryAgentRunRealtimeService } from './story-agent-run-realtime.service';
import { StoryAgentRunService } from './story-agent-run.service';
import { StoryAgentRunWorkerService } from './story-agent-run-worker.service';
import { StoryAuthoringPipelineService } from './story-authoring-pipeline.service';

/** Leaf module shared by HTTP Story Studio and server-side Copilot tooling. */
@Module({
  imports: [StoryAccessModule, RealtimeModule],
  controllers: [StoryAgentRunController],
  providers: [
    StoryAgentRunRealtimeService,
    StoryAgentRunService,
    StoryAuthoringPipelineService,
    StoryAgentRunWorkerService,
  ],
  exports: [StoryAgentRunService],
})
export class StoryAgentRunModule {}
