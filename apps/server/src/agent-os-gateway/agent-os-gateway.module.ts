import { Module } from '@nestjs/common';
import { StoryStudioModule } from '../story-studio/story-studio.module';
import { AgentOsDomainController } from './agent-os-domain.controller';
import { AgentOsDomainService } from './agent-os-domain.service';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';
import { AgentOsGatewayController } from './agent-os-gateway.controller';
import { AgentOsGatewayService } from './agent-os-gateway.service';
import { AgentOsWorkerClient } from './agent-os-worker.client';

@Module({
  // StoryStudioModule exports StoryAccessModule → StoryPermissionService.
  imports: [StoryStudioModule],
  controllers: [AgentOsGatewayController, AgentOsDomainController],
  providers: [
    AgentOsGatewayConfigService,
    AgentOsWorkerClient,
    AgentOsGatewayService,
    AgentOsDomainService,
  ],
  exports: [AgentOsGatewayService, AgentOsDomainService],
})
export class AgentOsGatewayModule {}
