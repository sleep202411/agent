import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { NotificationModule } from '../notification';
import { ConversationRealtimeModule } from './conversation-realtime.module';
import { ConversationRealtimeOutboxService } from './conversation-realtime-outbox.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

/**
 * Conversations — context-scoped messaging (service inquiries +
 * order threads). Self-contained on the server (no Java
 * dependency). Exports ConversationsService so OrdersModule can
 * post system messages, evolve context, and update proposal
 * status from within transactions.
 */
@Module({
  imports: [AuthModule, NotificationModule, ConversationRealtimeModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationRealtimeOutboxService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
