import { Logger, Module } from '@nestjs/common';
import { WorkspacesModule } from '../../workspaces';
import { RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';
import { REALTIME_PROVIDER, type RealtimeProvider } from './realtime-provider';
import { RealtimeReplayService } from './realtime-replay.service';
import { SelfHostedRealtimeService } from './self-hosted-realtime.service';
import { WebPubSubService } from './web-pubsub.service';

/**
 * Selects the realtime transport at boot. Default is `web-pubsub` (preserves the
 * Azure-backed .com behavior); the CN cell sets `REALTIME_TRANSPORT=self-hosted`
 * to use the in-cluster WS plane (Web PubSub does not serve CN). Fails loud if
 * self-hosted is selected without its signing secret — never a silent fallback.
 */
function selectRealtimeProvider(
  webPubSub: WebPubSubService,
  selfHosted: SelfHostedRealtimeService,
): RealtimeProvider {
  const transport = (process.env.REALTIME_TRANSPORT ?? 'web-pubsub')
    .trim()
    .toLowerCase();
  if (transport === 'self-hosted') {
    if (!process.env.REALTIME_WS_SECRET?.trim()) {
      throw new Error(
        'REALTIME_TRANSPORT=self-hosted requires REALTIME_WS_SECRET',
      );
    }
    new Logger('RealtimeModule').log('realtime transport: self-hosted');
    return selfHosted;
  }
  new Logger('RealtimeModule').log('realtime transport: web-pubsub');
  return webPubSub;
}

@Module({
  imports: [WorkspacesModule],
  controllers: [RealtimeController],
  providers: [
    WebPubSubService,
    SelfHostedRealtimeService,
    RealtimeReplayService,
    RealtimeGateway,
    {
      provide: REALTIME_PROVIDER,
      useFactory: selectRealtimeProvider,
      inject: [WebPubSubService, SelfHostedRealtimeService],
    },
  ],
  exports: [REALTIME_PROVIDER, WebPubSubService],
})
export class RealtimeModule {}
