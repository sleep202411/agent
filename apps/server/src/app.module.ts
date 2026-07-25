import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminAuthModule } from './admin-auth';
import { AgentUsersModule } from './agent-users';
import { AppReleaseModule } from './app-release';
import { AiGenerationModule } from './ai-generation/ai-generation.module';
import { AssistantModule } from './assistant/assistant.module';
import { AuthModule, AuthGuard } from './auth';
import { BillingModule } from './billing';
import { InternalModule } from './internal/internal.module';
import { CertificatesModule } from './certificates/certificates.module';
import { CharactersModule } from './characters/characters.module';
import { StoryStudioModule } from './story-studio/story-studio.module';
import { StudioAgentModule } from './studio-agent/studio-agent.module';
import { AlertingModule } from './common/alerting';
import { RegionModule } from './common/region';
import { ThrottleModule } from './common/throttle/throttle.module';
import { ConversationsModule } from './conversations/conversations.module';
import { CopilotModule } from './copilot/copilot.module';
import { CrewsModule } from './crews/crews.module';
import { CreatorServicesModule } from './creator-services/creator-services.module';
import { DocumentsModule } from './documents';
import { EpisodesModule } from './crews/episodes/episodes.module';
import { OrdersModule } from './orders/orders.module';
import { DbModule } from './infra/db/db.module';
import { HealthModule } from './infra/health/health.module';
import { LegacyMysqlModule } from './infra/legacy-mysql';
import { LegacyCreatorsModule } from './legacy-creators/legacy-creators.module';
import { LegacyPointsModule } from './legacy-points/legacy-points.module';
import { LegacyProjectsModule } from './legacy-projects/legacy-projects.module';
import { IpCommerceModule } from './ip-commerce';
import { MediaModule } from './media/media.module';
import { RealtimeModule } from './infra/realtime/realtime.module';
import { RedisModule } from './infra/redis/redis.module';
import { NotificationModule } from './notification';
import { QuotaModule } from './quota/quota.module';
import { ReferralsModule } from './referrals/referrals.module';
import { SparkModule } from './spark/spark.module';
import { SharingModule } from './sharing/sharing.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces';

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
    AppReleaseModule,
    // Region wires CountryMiddleware globally before any controller runs.
    RegionModule,
    // ThrottleModule is Global — provides RateLimitService to any consumer.
    ThrottleModule,
    AssistantModule,
    CopilotModule,
    SparkModule,
    AiGenerationModule,
    RealtimeModule,
    NotificationModule,
    QuotaModule,
    UsersModule,
    WorkspacesModule,
    SharingModule,
    BillingModule,
    InternalModule,
    LegacyPointsModule,
    IpCommerceModule,
    DocumentsModule,
    CertificatesModule,
    CharactersModule,
    StoryStudioModule,
    StudioAgentModule.register(),
    MediaModule,
    CrewsModule,
    EpisodesModule,
    CreatorServicesModule,
    ReferralsModule,
    ConversationsModule,
    OrdersModule,
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
