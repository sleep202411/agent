import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { WorkspaceService } from './workspace.service';
import { ScriptAgentService } from '../pipeline/script-agent.service';

@Module({
  controllers: [AssistantController],
  providers: [AssistantService, WorkspaceService, ScriptAgentService],
})
export class AssistantModule {}
