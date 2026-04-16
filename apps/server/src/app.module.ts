import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AiModule } from './ai/ai.module';
import { AgentModule } from './agent/agent.module';
import { AssistantModule } from './assistant/assistant.module';
import { TaskModule } from './pipeline/task/task.module';
import { AuthModule, AuthGuard } from './auth';

@Module({
  imports: [AuthModule, AiModule, AgentModule, AssistantModule, TaskModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
