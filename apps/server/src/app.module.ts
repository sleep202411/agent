import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AssistantModule } from './assistant/assistant.module';
import { AuthModule, AuthGuard } from './auth';
import { SparkModule } from './spark/spark.module';

@Module({
  imports: [AuthModule, AssistantModule, SparkModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
