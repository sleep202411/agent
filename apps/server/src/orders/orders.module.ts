import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { ConversationsModule } from '../conversations/conversations.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * Orders — service-order state machine over CreatorService /
 * ServicePackage. Owns the questionnaire-submit path and the
 * proposal-accept path; both materialize a ServiceOrder and
 * coordinate with ConversationsModule for the system-message
 * timeline.
 */
@Module({
  imports: [AuthModule, ConversationsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
