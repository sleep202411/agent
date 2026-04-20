import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceService } from './workspace.service';
import { MastraProxyController } from './mastra-proxy.controller';
import { AssetsProxyController } from './assets-proxy.controller';
import { DictionariesController } from './dictionaries.controller';
import { MessageStoreService } from './chat/message-store.service';
import { ChatEventsGateway } from './chat/chat-events.gateway';
import { AgentStreamService } from './chat/agent-stream.service';
import { ChatController } from './chat/chat.controller';
import { WorkflowProxyController } from './workflow/workflow-proxy.controller';
import { DraftsProxyController } from './workflow/drafts-proxy.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    MastraProxyController,
    AssetsProxyController,
    DictionariesController,
    ChatController,
    WorkflowProxyController,
    DraftsProxyController,
  ],
  providers: [
    WorkspaceService,
    MessageStoreService,
    ChatEventsGateway,
    AgentStreamService,
  ],
})
export class AssistantModule {}
