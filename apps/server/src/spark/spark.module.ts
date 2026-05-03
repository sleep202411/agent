import { Module } from '@nestjs/common';
import { SparkController } from './spark.controller';
import { SparkService } from './spark.service';

@Module({
  controllers: [SparkController],
  providers: [SparkService],
})
export class SparkModule {}
