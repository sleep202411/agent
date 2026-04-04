import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module';
import { AgentModule } from './agent/agent.module';
import { AssistantModule } from './assistant/assistant.module';

@Module({
  imports: [AiModule, AgentModule, AssistantModule],
})
export class AppModule {}
