import { Module } from '@nestjs/common';

import { AgentPlatformGatewayModule } from '../agent-platform-gateway';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { AgentDomainAuthGuard } from './agent-domain-auth.guard';
import { AgentDomainGatewayConfigService } from './agent-domain-gateway.config';
import { AgentDomainExecutionService } from './agent-domain-execution.service';
import { AgentDomainGatewayController } from './agent-domain-gateway.controller';
import { StoryAgentDomainService } from './story-agent-domain.service';
import { StorySourceMaterialDomainService } from './story-source-material-domain.service';

@Module({
  imports: [StoryAccessModule, AgentPlatformGatewayModule],
  controllers: [AgentDomainGatewayController],
  providers: [
    AgentDomainGatewayConfigService,
    AgentDomainAuthGuard,
    AgentDomainExecutionService,
    StoryAgentDomainService,
    StorySourceMaterialDomainService,
  ],
})
export class AgentDomainGatewayModule {}
