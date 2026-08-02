import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { ConversationRealtimeModule } from '../conversations/conversation-realtime.module';
import { NotificationController } from './notification.controller';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationService } from './notification.service';

/**
 * Notification module — REST inbox + durable Ably outbox delivery.
 *
 * Exports NotificationService so other modules (crew, episodes, future
 * render/video pipelines) can call `notifications.send(...)` directly.
 */
@Module({
  imports: [AuthModule, ConversationRealtimeModule],
  providers: [NotificationService, NotificationDispatcherService],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
