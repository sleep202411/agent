import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../../workspaces';
import { RealtimeController } from './realtime.controller';
import { REALTIME_PROVIDER } from './realtime-provider';
import { WebPubSubService } from './web-pubsub.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [RealtimeController],
  providers: [
    WebPubSubService,
    { provide: REALTIME_PROVIDER, useExisting: WebPubSubService },
  ],
  exports: [REALTIME_PROVIDER, WebPubSubService],
})
export class RealtimeModule {}
