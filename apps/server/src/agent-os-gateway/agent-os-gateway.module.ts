import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { AgentOsJournalModule } from '../agent-os-journal/agent-os-journal.module';
import { AblyTokenCredentialsModule } from '../infra/realtime/ably-token-credentials';
import { StoryStudioModule } from '../story-studio/story-studio.module';
import { StoryProductionPlanModule } from '../story-studio/story-production-plan.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ProjectSkillsModule } from '../project-skills';
import { AiGenerationModule } from '../ai-generation/ai-generation.module';
import { AgentOsAttachmentService } from './agent-os-attachment.service';
import { AgentOsCanvasShotsService } from './agent-os-canvas-shots.service';
import { AgentOsDomainController } from './agent-os-domain.controller';
import { AgentOsDomainService } from './agent-os-domain.service';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';
import { AgentOsGatewayController } from './agent-os-gateway.controller';
import { AgentOsGatewayService } from './agent-os-gateway.service';
import { AgentOsInternalController } from './agent-os-internal.controller';
import { AgentOsProjectContextService } from './agent-os-project-context.service';
import { AgentOsRunStartDispatcherService } from './agent-os-run-start-dispatcher.service';
import { AgentOsRunContinuationDispatcherService } from './agent-os-run-continuation-dispatcher.service';
import { AgentOsToolExecutionReceiptService } from './agent-os-tool-execution-receipt.service';
import { AgentOsWorkerClient } from './agent-os-worker.client';
import { AgentOsAblyTokenIssuer } from './agent-os.realtime';
import { AttachmentAgentCapabilityHandler } from './capabilities/attachment.handler';
import { PlatformAgentCapabilityHandler } from './capabilities/platform.handler';
import { StoryAgentCapabilityHandler } from './capabilities/story.handler';
import { AgentOsModelPreferencesService } from './agent-os-model-preferences.service';

@Module({
  imports: [
    StoryStudioModule,
    StoryProductionPlanModule,
    AgentOsJournalModule,
    WorkspacesModule,
    AblyTokenCredentialsModule,
    DocumentsModule,
    ProjectSkillsModule,
    AiGenerationModule,
  ],
  controllers: [
    AgentOsGatewayController,
    AgentOsDomainController,
    AgentOsInternalController,
  ],
  providers: [
    AgentOsGatewayConfigService,
    AgentOsWorkerClient,
    AgentOsRunStartDispatcherService,
    AgentOsRunContinuationDispatcherService,
    AgentOsGatewayService,
    AgentOsDomainService,
    AgentOsProjectContextService,
    AgentOsToolExecutionReceiptService,
    AgentOsAttachmentService,
    AgentOsAblyTokenIssuer,
    AgentOsCanvasShotsService,
    AttachmentAgentCapabilityHandler,
    PlatformAgentCapabilityHandler,
    StoryAgentCapabilityHandler,
    AgentOsModelPreferencesService,
  ],
  exports: [
    AgentOsGatewayService,
    AgentOsDomainService,
    AgentOsProjectContextService,
    AgentOsJournalModule,
    AgentOsAttachmentService,
  ],
})
export class AgentOsGatewayModule {}
