import { Module } from '@nestjs/common';

import { AblyTokenCredentialsModule } from '../infra/realtime/ably-token-credentials';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { StorageModule } from '../infra/storage/storage.module';
import { AgentPlatformAttachmentIngestService } from './agent-platform-attachment-ingest.service';
import { AgentPlatformAttachmentParser } from './agent-platform-attachment-parser';
import { AgentPlatformAttachmentService } from './agent-platform-attachment.service';
import { AgentPlatformAuthorizationService } from './agent-platform-authorization.service';
import { AgentPlatformConversationService } from './agent-platform-conversation.service';
import { AgentPlatformCredentialsService } from './agent-platform-credentials.service';
import { AgentPlatformDocumentAnalysisDispatcherService } from './agent-platform-document-analysis-dispatcher.service';
import { AgentPlatformDocumentAnalysisService } from './agent-platform-document-analysis.service';
import { AgentPlatformGatewayConfigService } from './agent-platform-gateway.config';
import { AgentPlatformGatewayController } from './agent-platform-gateway.controller';
import { AgentPlatformGatewayService } from './agent-platform-gateway.service';
import { AgentPlatformInvocationService } from './agent-platform-invocation.service';

@Module({
  imports: [StoryAccessModule, StorageModule, AblyTokenCredentialsModule],
  controllers: [AgentPlatformGatewayController],
  providers: [
    AgentPlatformGatewayConfigService,
    AgentPlatformCredentialsService,
    AgentPlatformAuthorizationService,
    AgentPlatformConversationService,
    AgentPlatformAttachmentParser,
    AgentPlatformDocumentAnalysisService,
    AgentPlatformDocumentAnalysisDispatcherService,
    AgentPlatformAttachmentIngestService,
    AgentPlatformAttachmentService,
    AgentPlatformInvocationService,
    AgentPlatformGatewayService,
  ],
  exports: [
    AgentPlatformConversationService,
    AgentPlatformDocumentAnalysisService,
    AgentPlatformDocumentAnalysisDispatcherService,
    AgentPlatformAttachmentIngestService,
    AgentPlatformAttachmentService,
    AgentPlatformInvocationService,
    AgentPlatformGatewayService,
  ],
})
export class AgentPlatformGatewayModule {}
