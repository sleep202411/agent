import { Module } from '@nestjs/common';
import { StoryStudioModule } from '../story-studio/story-studio.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AgentOsDomainController } from './agent-os-domain.controller';
import { AgentOsDomainService } from './agent-os-domain.service';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';
import { AgentOsGatewayController } from './agent-os-gateway.controller';
import { AgentOsGatewayService } from './agent-os-gateway.service';
import { AgentOsInternalController } from './agent-os-internal.controller';
import { AgentOsRunJournalService } from './agent-os-run-journal.service';
import { AgentOsWorkerClient } from './agent-os-worker.client';

@Module({
  imports: [StoryStudioModule, WorkspacesModule],
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
    AgentOsRunJournalService,
  ],
  exports: [
    AgentOsGatewayService,
    AgentOsDomainService,
    AgentOsRunJournalService,
  ],
})
export class AgentOsGatewayModule {}
