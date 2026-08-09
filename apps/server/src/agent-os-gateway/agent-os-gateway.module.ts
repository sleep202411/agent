import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { AblyTokenCredentialsModule } from '../infra/realtime/ably-token-credentials';
import { StoryStudioModule } from '../story-studio/story-studio.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AgentOsAttachmentService } from './agent-os-attachment.service';
import { AgentOsCanvasShotsService } from './agent-os-canvas-shots.service';
import { AgentOsDomainController } from './agent-os-domain.controller';
import { AgentOsDomainService } from './agent-os-domain.service';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';
import { AgentOsGatewayController } from './agent-os-gateway.controller';
import { AgentOsGatewayService } from './agent-os-gateway.service';
import { AgentOsInternalController } from './agent-os-internal.controller';
import { AgentOsProjectContextService } from './agent-os-project-context.service';
import { AgentOsRunJournalService } from './agent-os-run-journal.service';
import { AgentOsWorkerClient } from './agent-os-worker.client';
import { AgentOsAblyTokenIssuer } from './agent-os.realtime';
import { AttachmentAgentCapabilityHandler } from './capabilities/attachment.handler';
import { PlatformAgentCapabilityHandler } from './capabilities/platform.handler';
import { StoryAgentCapabilityHandler } from './capabilities/story.handler';

@Module({
  imports: [
    StoryStudioModule,
    WorkspacesModule,
    AblyTokenCredentialsModule,
    DocumentsModule,
  ],
  controllers: [
    AgentOsGatewayController,
    AgentOsDomainController,
    AgentOsInternalController,
  ],
  providers: [
    AgentOsGatewayConfigService,
    AgentOsWorkerClient,
    AgentOsGatewayService,
    AgentOsDomainService,
    AgentOsProjectContextService,
    AgentOsRunJournalService,
    AgentOsAttachmentService,
    AgentOsAblyTokenIssuer,
    AgentOsCanvasShotsService,
    AttachmentAgentCapabilityHandler,
    PlatformAgentCapabilityHandler,
    StoryAgentCapabilityHandler,
  ],
  exports: [
    AgentOsGatewayService,
    AgentOsDomainService,
    AgentOsProjectContextService,
    AgentOsRunJournalService,
    AgentOsAttachmentService,
  ],
})
export class AgentOsGatewayModule {}
