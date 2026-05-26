import { Module, type OnModuleInit } from '@nestjs/common';
import { RealtimeModule } from '../infra/realtime/realtime.module';
import { StorageModule } from '../infra/storage/storage.module';
import { AiGenerationController } from './ai-generation.controller';
import { AiGenerationService } from './ai-generation.service';
import { AiGenerationAuthzService } from './authz.service';
import { AiGenerationEtaService } from './eta.service';
import { AiModelPresetRegistryService } from './model-preset-registry.service';
import { AiGenerationOutboxService } from './outbox.service';
import { ProviderRegistry } from './provider-registry.service';
import { FoundryProviderAdapter } from './providers/foundry/foundry-provider.adapter';
import { FoundryCatalogService } from './providers/foundry/catalog.service';
import { FoundrySchemaFactory } from './providers/foundry/schema.factory';
import { FoundrySchemaRegistry } from './providers/foundry/schema.registry';
import { FalCatalogService } from './providers/fal/fal-catalog.service';
import { FalClient } from './providers/fal/fal-client';
import { FalConfigService } from './providers/fal/fal-config.service';
import { FalProviderAdapter } from './providers/fal/fal-provider.adapter';
import { AiGenerationQueueService } from './queue.service';
import { AiGenerationRepository } from './repository';
import { AiGenerationRoutingService } from './routing.service';
import { AiGenerationValidatorService } from './validator.service';
import { AiGenerationWorkerService } from './worker.service';

@Module({
  imports: [RealtimeModule, StorageModule],
  controllers: [AiGenerationController],
  providers: [
    // Generic layer
    AiGenerationService,
    AiGenerationRepository,
    AiGenerationWorkerService,
    AiGenerationQueueService,
    AiGenerationOutboxService,
    AiGenerationRoutingService,
    AiModelPresetRegistryService,
    AiGenerationAuthzService,
    AiGenerationEtaService,
    AiGenerationValidatorService,
    ProviderRegistry,

    // Provider: Foundry (Azure)
    FoundryCatalogService,
    FoundrySchemaFactory,
    FoundrySchemaRegistry,
    FoundryProviderAdapter,

    // Provider: fal.ai
    FalConfigService,
    FalCatalogService,
    FalClient,
    FalProviderAdapter,
  ],
})
export class AiGenerationModule implements OnModuleInit {
  /**
   * Self-register every provider adapter into the ProviderRegistry on
   * boot. Adapters are plain @Injectable() classes — they don't know
   * about the registry; the module wires them together so adapter
   * code stays focused on the provider contract.
   */
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly foundry: FoundryProviderAdapter,
    private readonly fal: FalProviderAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.foundry);
    this.registry.register(this.fal);
    // Future:
    //   this.registry.register(this.replicate);
  }
}
