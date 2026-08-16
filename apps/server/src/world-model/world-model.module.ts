import { Module } from '@nestjs/common';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { FalHappyOysterAdapter } from './providers/fal-happy-oyster/fal-happy-oyster.adapter';
import { FalHappyOysterClient } from './providers/fal-happy-oyster/fal-happy-oyster.client';
import { FalHappyOysterConfig } from './providers/fal-happy-oyster/fal-happy-oyster.config';
import { WorldModelController } from './world-model.controller';
import { WORLD_MODEL_PROVIDERS } from './world-model-provider';
import { WorldModelProviderRegistry } from './world-model-provider.registry';
import { WorldModelService } from './world-model.service';

@Module({
  imports: [StoryAccessModule],
  controllers: [WorldModelController],
  providers: [
    FalHappyOysterConfig,
    FalHappyOysterClient,
    FalHappyOysterAdapter,
    {
      provide: WORLD_MODEL_PROVIDERS,
      inject: [FalHappyOysterAdapter],
      useFactory: (happyOyster: FalHappyOysterAdapter) => [happyOyster],
    },
    WorldModelProviderRegistry,
    WorldModelService,
  ],
  exports: [WorldModelService],
})
export class WorldModelModule {}
