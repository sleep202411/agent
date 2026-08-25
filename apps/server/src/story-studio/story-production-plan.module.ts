import { Module } from '@nestjs/common';
import { AiGenerationModule } from '../ai-generation/ai-generation.module';
import { StorageModule } from '../infra/storage/storage.module';
import { StoryAccessModule } from './story-access.module';
import { StoryProductionGenerationController } from './story-production-generation.controller';
import { StoryProductionGenerationService } from './story-production-generation.service';
import { StoryProductionPlanController } from './story-production-plan.controller';
import { StoryProductionPlanService } from './story-production-plan.service';

@Module({
  imports: [StoryAccessModule, AiGenerationModule, StorageModule],
  controllers: [
    StoryProductionPlanController,
    StoryProductionGenerationController,
  ],
  providers: [StoryProductionPlanService, StoryProductionGenerationService],
  exports: [StoryProductionPlanService, StoryProductionGenerationService],
})
export class StoryProductionPlanModule {}
