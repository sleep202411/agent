import { AcademyModule } from './academy/academy.module';
import { CreatorWithdrawalsModule } from './creator-withdrawals/creator-withdrawals.module';
import { DiscoveryAssistantModule } from './discovery-assistant/discovery-assistant.module';
import { AiActorsModule } from './ai-actors/ai-actors.module';
import { Module } from '@nestjs/common';
import { TasksModule } from './tasks/tasks.module';
import { APP_GUARD } from '@nestjs/core';
import { AdminAuthModule } from './admin-auth';
import { AgentUsersModule } from './agent-users';
import { AgentOsGatewayModule } from './agent-os-gateway';
import { GameAgentModule } from './game-agent/game-agent.module';
import { gameAgentEnabled } from './game-agent/game-agent.config';
import { AppReleaseModule } from './app-release';
import { AiGenerationModule } from './ai-generation/ai-generation.module';
import { AssistantModule } from './assistant/assistant.module';
import { AuthModule, AuthGuard } from './auth';
import { BillingModule } from './billing';
import { BoldSignWebhookProvisioningModule } from './boldsign-webhook-provisioning/boldsign-webhook-provisioning.module';
import { InternalModule } from './internal/internal.module';
import { CertificatesModule } from './certificates/certificates.module';
import { CharactersModule } from './characters/characters.module';
import { StoryStudioModule } from './story-studio/story-studio.module';
import { StoryPlaybackModule } from './story-studio/playback/story-playback.module';
import { AlertingModule } from './common/alerting';
import { RegionModule } from './common/region';
import { ThrottleModule } from './common/throttle/throttle.module';
import { ConversationsModule } from './conversations/conversations.module';
import { CopilotModule } from './copilot/copilot.module';
import { CrewsModule } from './crews/crews.module';
import { CreatorServicesModule } from './creator-services/creator-services.module';
import { DocumentsModule } from './documents';
import { OrdersModule } from './orders/orders.module';
import { ProjectSectionsModule } from './project-sections';
import { ProjectSkillsModule } from './project-skills';
import { DbModule } from './infra/db/db.module';
import { HealthModule } from './infra/health/health.module';
import { LegacyMysqlModule } from './infra/legacy-mysql';
import { LegacyCreatorsModule } from './legacy-creators/legacy-creators.module';
import { LegacyPointsModule } from './legacy-points/legacy-points.module';
import { LegacyProjectsModule } from './legacy-projects/legacy-projects.module';
import { IpCommerceModule } from './ip-commerce';
import { MediaModule } from './media/media.module';
import { StoryboardExportModule } from './storyboard-export/storyboard-export.module';
import { RealtimeModule } from './infra/realtime/realtime.module';
import { RedisModule } from './infra/redis/redis.module';
import { NotificationModule } from './notification';
import { QuotaModule } from './quota/quota.module';
import { ReferralsModule } from './referrals/referrals.module';
import { SparkModule } from './spark/spark.module';
import { SharingModule } from './sharing/sharing.module';
import { StorySavesModule } from './story-saves/story-saves.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces';
import { WorldModelModule } from './world-model/world-model.module';

const agentOsGatewayEnabled = (() => {
  const raw = (process.env.AGENT_OS_ENABLED ?? 'false').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error('AGENT_OS_ENABLED must be either "true" or "false".');
})();

@Module({
  imports: [
    // Infra modules first — global, others can inject PrismaService / REDIS.
    DbModule,
    RedisModule,
    // Legacy Java MySQL bridge — anchored here so its boot-time ping /
    // fail-fast runs even before a feature consumes it. Dormant unless
    // LEGACY_MYSQL_ENABLED=true. NOT global: feature modules that need
    // it import LegacyMysqlModule explicitly to inject LegacyMysqlService.
    LegacyMysqlModule,
    LegacyProjectsModule,
    LegacyCreatorsModule,
    AlertingModule,
    AuthModule,
    AdminAuthModule,
    AgentUsersModule,
    ...(agentOsGatewayEnabled ? [AgentOsGatewayModule] : []),
    ...(gameAgentEnabled() ? [GameAgentModule] : []),
    AppReleaseModule,
    // Region wires CountryMiddleware globally before any controller runs.
    RegionModule,
    // ThrottleModule is Global — provides RateLimitService to any consumer.
    ThrottleModule,
    AssistantModule,
    CopilotModule,
    SparkModule,
    AiGenerationModule,
    TasksModule,
    RealtimeModule,
    NotificationModule,
    QuotaModule,
    UsersModule,
    WorkspacesModule,
    SharingModule,
    BillingModule,
    BoldSignWebhookProvisioningModule,
    InternalModule,
    LegacyPointsModule,
    IpCommerceModule,
    DiscoveryAssistantModule,
    DocumentsModule,
    CertificatesModule,
    CharactersModule,
    StoryStudioModule,
    StoryPlaybackModule,
    MediaModule,
    StoryboardExportModule,
    AiActorsModule,
    CrewsModule,
    CreatorServicesModule,
    CreatorWithdrawalsModule,
    AcademyModule,
    ReferralsModule,
    StorySavesModule,
    ConversationsModule,
    OrdersModule,
    ProjectSectionsModule,
    ProjectSkillsModule,
    WorldModelModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
