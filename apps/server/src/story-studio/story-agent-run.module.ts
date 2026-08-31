import { Module } from '@nestjs/common';
import { AgentOsJournalModule } from '../agent-os-journal/agent-os-journal.module';
import { DocumentsModule } from '../documents/documents.module';
import { RealtimeModule } from '../infra/realtime/realtime.module';
import { StoryAccessModule } from './story-access.module';
import { StoryAgentRunController } from './story-agent-run.controller';
import { StoryAgentRunContinuationWorkerService } from './story-agent-run-continuation-worker.service';
import { StoryAgentRunRealtimeService } from './story-agent-run-realtime.service';
import { StoryAgentRunService } from './story-agent-run.service';
import { StoryAgentRunWorkerService } from './story-agent-run-worker.service';
import { StoryGenerationBatchContinuationWorkerService } from './story-generation-batch-continuation-worker.service';
import { StoryAuthoringPipelineService } from './story-authoring-pipeline.service';
import { StoryProductionPlanModule } from './story-production-plan.module';

/** Leaf module shared by HTTP Story Studio and server-side Copilot tooling. */
@Module({
  imports: [
    StoryAccessModule,
    RealtimeModule,
    AgentOsJournalModule,
    DocumentsModule,
    StoryProductionPlanModule,
  ],
  controllers: [StoryAgentRunController],
  providers: [
    StoryAgentRunRealtimeService,
    StoryAgentRunService,
    StoryAuthoringPipelineService,
    StoryAgentRunWorkerService,
    StoryAgentRunContinuationWorkerService,
    StoryGenerationBatchContinuationWorkerService,
  ],
  exports: [StoryAgentRunService],
})
export class StoryAgentRunModule {}
