import { Module } from '@nestjs/common';
import { AiGenerationModule } from '../ai-generation/ai-generation.module';
import { StorageModule } from '../infra/storage/storage.module';
import { StoryAccessModule } from './story-access.module';
import { StoryProductionGenerationController } from './story-production-generation.controller';
import { StoryProductionGenerationService } from './story-production-generation.service';
import { StoryProductionPlanController } from './story-production-plan.controller';
import { StoryProductionPlanService } from './story-production-plan.service';
import { StoryGenerationBatchController } from './story-generation-batch.controller';
import { StoryGenerationBatchDispatcherService } from './story-generation-batch-dispatcher.service';
import { StoryGenerationBatchService } from './story-generation-batch.service';

@Module({
  imports: [StoryAccessModule, AiGenerationModule, StorageModule],
  controllers: [
    StoryProductionPlanController,
    StoryProductionGenerationController,
    StoryGenerationBatchController,
  ],
  providers: [
    StoryProductionPlanService,
    StoryProductionGenerationService,
    StoryGenerationBatchService,
    StoryGenerationBatchDispatcherService,
  ],
  exports: [
    StoryProductionPlanService,
    StoryProductionGenerationService,
    StoryGenerationBatchService,
  ],
})
export class StoryProductionPlanModule {}
