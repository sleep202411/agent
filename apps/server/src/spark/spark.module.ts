import { Module } from '@nestjs/common';
import { SparkController } from './spark.controller';
import { SparkService } from './spark.service';

@Module({
  controllers: [SparkController],
  providers: [SparkService],
  // Exported so AssistantModule's ProduceProxyController can reuse the
  // text-extraction + Redis-cache pipeline for multipart step1 uploads
  // without depending on the spark/analyze LLM call.
  exports: [SparkService],
})
export class SparkModule {}
