import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AiGenerationModule } from './ai-generation/ai-generation.module';
import { AssistantModule } from './assistant/assistant.module';
import { AuthModule, AuthGuard } from './auth';
import { CertificatesModule } from './certificates/certificates.module';
import { RegionModule } from './common/region';
import { ThrottleModule } from './common/throttle/throttle.module';
import { ConversationsModule } from './conversations/conversations.module';
import { CrewsModule } from './crews/crews.module';
import { CreatorServicesModule } from './creator-services/creator-services.module';
import { DocumentsModule } from './documents';
import { EpisodesModule } from './crews/episodes/episodes.module';
import { OrdersModule } from './orders/orders.module';
import { DbModule } from './infra/db/db.module';
import { HealthModule } from './infra/health/health.module';
import { RealtimeModule } from './infra/realtime/realtime.module';
import { RedisModule } from './infra/redis/redis.module';
import { NotificationModule } from './notification';
import { QuotaModule } from './quota/quota.module';
import { SparkModule } from './spark/spark.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces';

@Module({
  imports: [
    // Infra modules first — global, others can inject PrismaService / REDIS.
    DbModule,
    RedisModule,
    AuthModule,
    // Region wires CountryMiddleware globally before any controller runs.
    RegionModule,
    // ThrottleModule is Global — provides RateLimitService to any consumer.
    ThrottleModule,
    AssistantModule,
    SparkModule,
    AiGenerationModule,
    RealtimeModule,
    NotificationModule,
    QuotaModule,
    UsersModule,
    WorkspacesModule,
    DocumentsModule,
    CertificatesModule,
    CrewsModule,
    EpisodesModule,
    CreatorServicesModule,
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
