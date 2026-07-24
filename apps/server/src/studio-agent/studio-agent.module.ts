import { type DynamicModule, Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements';
import { StorageModule } from '../infra/storage/storage.module';
import { QuotaModule } from '../quota/quota.module';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { StudioAgentArtifactController } from './studio-agent-artifact.controller';
import { StudioAgentArtifactCleanupWorker } from './studio-agent-artifact-cleanup.service';
import { StudioAgentArtifactService } from './studio-agent-artifact.service';
import { StudioAgentDocumentParserRunner } from './studio-agent-document-parser-runner';
import { StudioAgentDocumentService } from './studio-agent-document.service';
import { StudioAgentRuntimeTokenGuard } from './studio-agent-runtime-token.guard';
import { StudioAgentRuntimeController } from './studio-agent-runtime.controller';
import { StudioAgentRuntimeService } from './studio-agent-runtime.service';
import { StudioAgentCapabilityExecutor } from './studio-agent.capability-executor';
import { StudioAgentConfigService } from './studio-agent.config';
import { StudioAgentController } from './studio-agent.controller';
import {
  StudioAgentEventNotifier,
  StudioAgentEventStore,
} from './studio-agent.events';
import { StudioAgentCommandOutboxDispatcher } from './studio-agent.outbox';
import { StudioAgentPolicyEngine } from './studio-agent.policy';
import { StudioAgentQuotaService } from './studio-agent-quota.service';
import { StudioAgentRegistry } from './studio-agent.registry';
import { StudioAgentRunTerminalService } from './studio-agent-run-terminal.service';
import { StudioAgentScopeAuthorizer } from './studio-agent.scope';
import { StudioAgentService } from './studio-agent.service';
import { StudioAgentStoryCapabilities } from './studio-agent.story-capabilities';
import { StudioAgentTemporalTransport } from './studio-agent.temporal';

const STUDIO_AGENT_CONTROLLERS = [
  StudioAgentController,
  StudioAgentArtifactController,
  StudioAgentRuntimeController,
] as const;

const STUDIO_AGENT_PROVIDERS = [
  StudioAgentConfigService,
  StudioAgentRegistry,
  StudioAgentPolicyEngine,
  StudioAgentScopeAuthorizer,
  StudioAgentEventNotifier,
  StudioAgentEventStore,
  StudioAgentStoryCapabilities,
  StudioAgentCapabilityExecutor,
  StudioAgentArtifactService,
  StudioAgentDocumentParserRunner,
  StudioAgentDocumentService,
  StudioAgentArtifactCleanupWorker,
  StudioAgentQuotaService,
  StudioAgentService,
  StudioAgentRunTerminalService,
  StudioAgentRuntimeService,
  StudioAgentRuntimeTokenGuard,
  StudioAgentTemporalTransport,
  StudioAgentCommandOutboxDispatcher,
] as const;

/**
 * Complete Studio Agent server boundary.
 *
 * Registered unconditionally: this is a product surface every region runs, not
 * a rollout that can be half-present. Required configuration therefore fails
 * loudly at bootstrap instead of degrading into a deployment whose routes
 * silently 404 while the client still offers the entry point.
 */
@Module({})
export class StudioAgentModule {
  static register(): DynamicModule {
    return {
      module: StudioAgentModule,
      imports: [
        StoryAccessModule,
        StorageModule,
        EntitlementsModule,
        QuotaModule,
      ],
      controllers: [...STUDIO_AGENT_CONTROLLERS],
      providers: [...STUDIO_AGENT_PROVIDERS],
    };
  }
}
