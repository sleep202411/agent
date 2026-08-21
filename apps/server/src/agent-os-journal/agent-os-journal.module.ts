import { Module } from '@nestjs/common';
import { AblyTokenCredentialsModule } from '../infra/realtime/ably-token-credentials';
import { AgentOsExternalHandoffReconcilerService } from './agent-os-external-handoff-reconciler.service';
import { AgentOsRealtimeOutboxService } from './agent-os-realtime-outbox.service';
import { AgentOsRunJournalService } from './agent-os-run-journal.service';

/**
 * Neutral durable Agent OS journal boundary.
 *
 * Both the interactive Gateway and long-running product workflows append to
 * the same immutable event stream without either module importing the other.
 */
@Module({
  imports: [AblyTokenCredentialsModule],
  providers: [
    AgentOsRealtimeOutboxService,
    AgentOsRunJournalService,
    AgentOsExternalHandoffReconcilerService,
  ],
  exports: [AgentOsRunJournalService],
})
export class AgentOsJournalModule {}
