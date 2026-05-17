import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AssistantModule } from './assistant/assistant.module';
import { AuthModule, AuthGuard } from './auth';
import { DbModule } from './infra/db/db.module';
import { HealthModule } from './infra/health/health.module';
import { RealtimeModule } from './infra/realtime/realtime.module';
import { RedisModule } from './infra/redis/redis.module';
import { SparkModule } from './spark/spark.module';

@Module({
  imports: [
    // Infra modules first — global, others can inject PrismaService / REDIS.
    DbModule,
    RedisModule,
    AuthModule,
    AssistantModule,
    SparkModule,
    RealtimeModule,
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
