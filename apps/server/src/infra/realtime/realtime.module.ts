import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../../workspaces';
import { RealtimeController } from './realtime.controller';
import { WebPubSubService } from './web-pubsub.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [RealtimeController],
  providers: [WebPubSubService],
  exports: [WebPubSubService],
})
export class RealtimeModule {}
