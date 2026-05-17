import { Module } from '@nestjs/common';
import { RealtimeModule } from '../infra/realtime/realtime.module';
import { StorageModule } from '../infra/storage/storage.module';
import { AiGenerationAuthzService } from './authz.service';
import { FoundryCatalogService } from './providers/foundry/catalog.service';
import { AiGenerationController } from './ai-generation.controller';
import { AiGenerationEtaService } from './eta.service';
import { AiGenerationRepository } from './repository';
import { AiGenerationOutboxService } from './outbox.service';
import { AiGenerationQueueService } from './queue.service';
import { FoundrySchemaFactory } from './providers/foundry/schema.factory';
import { FoundrySchemaRegistry } from './providers/foundry/schema.registry';
import { AiGenerationService } from './ai-generation.service';
import { AiGenerationValidatorService } from './validator.service';
import { AiGenerationWorkerService } from './worker.service';

@Module({
  imports: [RealtimeModule, StorageModule],
  controllers: [AiGenerationController],
  providers: [
    AiGenerationAuthzService,
    FoundryCatalogService,
    AiGenerationEtaService,
    AiGenerationRepository,
    AiGenerationOutboxService,
    AiGenerationQueueService,
    FoundrySchemaFactory,
    FoundrySchemaRegistry,
    AiGenerationService,
    AiGenerationValidatorService,
    AiGenerationWorkerService,
  ],
})
export class AiGenerationModule {}
