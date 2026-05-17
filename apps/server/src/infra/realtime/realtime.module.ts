import { Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import { WebPubSubService } from './web-pubsub.service';

@Module({
  controllers: [RealtimeController],
  providers: [WebPubSubService],
  exports: [WebPubSubService],
})
export class RealtimeModule {}
