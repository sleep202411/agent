import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { NotificationController } from './notification.controller';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationGateway } from './notification.gateway';
import { NotificationService } from './notification.service';

/**
 * Notification module — REST + WS surface for the in-app inbox + the
 * outbox dispatcher that drains the persistent queue to Redis pub/sub.
 *
 * Exports NotificationService so other modules (crew, episodes, future
 * render/video pipelines) can call `notifications.send(...)` directly.
 */
@Module({
  imports: [AuthModule],
  providers: [
    NotificationService,
    NotificationGateway,
    NotificationDispatcherService,
  ],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
