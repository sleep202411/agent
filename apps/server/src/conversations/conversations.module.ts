import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { ConversationsController } from './conversations.controller';
import { ConversationsGateway } from './conversations.gateway';
import { ConversationsService } from './conversations.service';

/**
 * Conversations — context-scoped messaging (service inquiries +
 * order threads). Self-contained on the server (no Java
 * dependency). Exports ConversationsService so OrdersModule can
 * post system messages, evolve context, and update proposal
 * status from within transactions.
 */
@Module({
  imports: [AuthModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationsGateway],
  exports: [ConversationsService],
})
export class ConversationsModule {}
