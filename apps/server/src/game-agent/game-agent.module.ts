import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { GameAgentAppearanceController } from './game-agent-appearance.controller';
import { GameAgentConfigService } from './game-agent.config';
import { GameAgentWorkerClient } from './game-agent-worker.client';
import { GameAgentWebProxyController } from './game-agent-web-proxy.controller';
import { GameAgentWebTransportService } from './game-agent-web-transport.service';

/** Independent of Agent OS Gateway, LangGraph journals and Ably. */
@Module({
  imports: [StoryAccessModule, AuthModule],
  controllers: [GameAgentAppearanceController, GameAgentWebProxyController],
  providers: [
    GameAgentConfigService,
    GameAgentWorkerClient,
    GameAgentWebTransportService,
  ],
  exports: [GameAgentWebTransportService],
})
export class GameAgentModule {}
