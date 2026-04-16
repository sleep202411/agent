import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { WorkspaceService } from './workspace.service';
import { ConversationService } from './conversation.service';
import { ScriptAgentService } from '../pipeline/script-agent.service';
import { TaskModule } from '../pipeline/task/task.module';

@Module({
  imports: [TaskModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    WorkspaceService,
    ConversationService,
    ScriptAgentService,
  ],
})
export class AssistantModule {}
