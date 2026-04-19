import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { WorkspaceService } from './workspace.service';
import { ConversationService } from './conversation.service';
import { ScriptAgentService } from '../pipeline/script-agent.service';
import { TaskModule } from '../pipeline/task/task.module';
import { AuthModule } from '../auth/auth.module';
// v3 proxy controllers (thin pass-through to the Mastra agent service).
// Kept alongside the legacy controllers until the frontend fully migrates.
import { MastraProxyController } from './mastra-proxy.controller';
import { WorkflowProxyController } from './workflow-proxy.controller';
import { DraftsProxyController } from './drafts-proxy.controller';
import { AssetsProxyController } from './assets-proxy.controller';
import { WorkflowEventsGateway } from './workflow-events.gateway';

@Module({
  imports: [TaskModule, AuthModule],
  controllers: [
    AssistantController,
    MastraProxyController,
    WorkflowProxyController,
    DraftsProxyController,
    AssetsProxyController,
  ],
  providers: [
    AssistantService,
    WorkspaceService,
    ConversationService,
    ScriptAgentService,
    WorkflowEventsGateway,
  ],
})
export class AssistantModule {}
