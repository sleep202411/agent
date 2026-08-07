import { Module } from '@nestjs/common';
import { StoryStudioModule } from '../story-studio/story-studio.module';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';
import { AgentOsGatewayController } from './agent-os-gateway.controller';
import { AgentOsGatewayService } from './agent-os-gateway.service';
import { AgentOsWorkerClient } from './agent-os-worker.client';

@Module({
  // StoryStudioModule exports StoryPermissionService for project authz.
  imports: [StoryStudioModule],
  controllers: [AgentOsGatewayController],
  providers: [
    AgentOsGatewayConfigService,
    AgentOsWorkerClient,
    AgentOsGatewayService,
  ],
  exports: [AgentOsGatewayService],
})
export class AgentOsGatewayModule {}
