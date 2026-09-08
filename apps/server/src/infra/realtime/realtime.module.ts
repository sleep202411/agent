import { Logger, Module } from '@nestjs/common';
import { WorkspacesModule } from '../../workspaces';
import { StoryAccessModule } from '../../story-studio/story-access.module';
import { RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';
import { REALTIME_PROVIDER, type RealtimeProvider } from './realtime-provider';
import { RealtimeReplayService } from './realtime-replay.service';
import { SelfHostedRealtimeService } from './self-hosted-realtime.service';

/** Realtime requires an explicit transport and signing secret. */
function selectRealtimeProvider(
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
  throw new Error('REALTIME_TRANSPORT must be self-hosted');
}

@Module({
  imports: [WorkspacesModule, StoryAccessModule],
  controllers: [RealtimeController],
  providers: [
    SelfHostedRealtimeService,
    RealtimeReplayService,
    RealtimeGateway,
    {
      provide: REALTIME_PROVIDER,
      useFactory: selectRealtimeProvider,
      inject: [SelfHostedRealtimeService],
    },
  ],
  exports: [REALTIME_PROVIDER],
})
export class RealtimeModule {}
