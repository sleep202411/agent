import { Logger, Module } from '@nestjs/common';
import { WorkspacesModule } from '../../workspaces';
import { NoOpRealtimeService } from './no-op-realtime.service';
import { RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';
import { REALTIME_PROVIDER, type RealtimeProvider } from './realtime-provider';
import { RealtimeReplayService } from './realtime-replay.service';
import { SelfHostedRealtimeService } from './self-hosted-realtime.service';

/**
 * Selects the realtime transport at boot. Prod cells (both .com and .cn) set
 * `REALTIME_TRANSPORT=self-hosted` to use the in-cluster WS plane; it fails loud
 * if self-hosted is selected without its signing secret — never a silent
 * fallback. Any other value (e.g. unset in local dev) selects the no-op provider
 * so the server still boots with realtime simply disabled.
 *
 * The Azure Web PubSub transport was decommissioned in P5 — self-hosted is the
 * only real transport now (Web PubSub never served CN, and .com migrated off it).
 */
function selectRealtimeProvider(
  noOp: NoOpRealtimeService,
  selfHosted: SelfHostedRealtimeService,
): RealtimeProvider {
  const transport = (process.env.REALTIME_TRANSPORT ?? '').trim().toLowerCase();
  if (transport === 'self-hosted') {
    if (!process.env.REALTIME_WS_SECRET?.trim()) {
      throw new Error(
        'REALTIME_TRANSPORT=self-hosted requires REALTIME_WS_SECRET',
      );
    }
    new Logger('RealtimeModule').log('realtime transport: self-hosted');
    return selfHosted;
  }
  new Logger('RealtimeModule').warn(
    'realtime transport: none — set REALTIME_TRANSPORT=self-hosted to enable',
  );
  return noOp;
}

@Module({
  imports: [WorkspacesModule],
  controllers: [RealtimeController],
  providers: [
    NoOpRealtimeService,
    SelfHostedRealtimeService,
    RealtimeReplayService,
    RealtimeGateway,
    {
      provide: REALTIME_PROVIDER,
      useFactory: selectRealtimeProvider,
      inject: [NoOpRealtimeService, SelfHostedRealtimeService],
    },
  ],
  exports: [REALTIME_PROVIDER],
})
export class RealtimeModule {}
