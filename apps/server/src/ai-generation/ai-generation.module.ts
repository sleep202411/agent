import { Module, type OnModuleInit } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { RealtimeModule } from '../infra/realtime/realtime.module';
import { StorageModule } from '../infra/storage/storage.module';
import { EntitlementsModule } from '../entitlements';
import { WorkspacesModule } from '../workspaces';
import { AiModelOpsController } from './admin/ai-model-ops.controller';
import { AiModelOpsService } from './admin/ai-model-ops.service';
import { AiGenerationController } from './ai-generation.controller';
import { AiGenerationService } from './ai-generation.service';
import { AiGenerationBillingWalletService } from './billing-wallet.service';
import { AiCanonicalCatalogService } from './canonical-catalog.service';
import { AiGenerationAuthzService } from './authz.service';
import { AiGenerationEtaService } from './eta.service';
import { AiModelPresetRegistryService } from './model-preset-registry.service';
import { AiGenerationOutboxService } from './outbox.service';
import { ProviderAccountReconciler } from './provider-account-reconciler.service';
import { ProviderRegistry } from './provider-registry.service';
import { ProviderCapacityRuntimeService } from './provider-capacity-runtime.service';
import { AiPromptCompilerService } from './prompt-compiler.service';
import { FoundryProviderAdapter } from './providers/foundry/foundry-provider.adapter';
import { FoundryCatalogService } from './providers/foundry/catalog.service';
import { FoundrySchemaFactory } from './providers/foundry/schema.factory';
import { FoundrySchemaRegistry } from './providers/foundry/schema.registry';
import { FalCatalogService } from './providers/fal/fal-catalog.service';
import { FalClient } from './providers/fal/fal-client';
import { FalConfigService } from './providers/fal/fal-config.service';
import { FalProviderAdapter } from './providers/fal/fal-provider.adapter';
import { BailianCatalogService } from './providers/bailian/bailian-catalog.service';
import { BailianClient } from './providers/bailian/bailian-client';
import { BailianConfigService } from './providers/bailian/bailian-config.service';
import { BailianProviderAdapter } from './providers/bailian/bailian-provider.adapter';
import { ReplicateCatalogService } from './providers/replicate/replicate-catalog.service';
import { ReplicateClient } from './providers/replicate/replicate-client';
import { ReplicateConfigService } from './providers/replicate/replicate-config.service';
import { ReplicateProviderAdapter } from './providers/replicate/replicate-provider.adapter';
import { BytePlusCatalogService } from './providers/byteplus/byteplus-catalog.service';
import { BytePlusClient } from './providers/byteplus/byteplus-client';
import { BytePlusConfigService } from './providers/byteplus/byteplus-config.service';
import { BytePlusProviderAdapter } from './providers/byteplus/byteplus-provider.adapter';
import { AiGenerationQueueService } from './queue.service';
import { AiGenerationRepository } from './repository';
import { AiGenerationRoutingService } from './routing.service';
import { AiGenerationValidatorService } from './validator.service';
import { AiGenerationWorkerService } from './worker.service';

@Module({
  imports: [
    AdminAuthModule,
    RealtimeModule,
    StorageModule,
    EntitlementsModule,
    WorkspacesModule,
  ],
  controllers: [AiGenerationController, AiModelOpsController],
  providers: [
    // Generic layer
    AiGenerationService,
    AiGenerationBillingWalletService,
    AiCanonicalCatalogService,
    AiGenerationRepository,
    AiGenerationWorkerService,
    AiGenerationQueueService,
    AiGenerationOutboxService,
    AiGenerationRoutingService,
    AiModelPresetRegistryService,
    AiGenerationAuthzService,
    AiGenerationEtaService,
    AiGenerationValidatorService,
    AiPromptCompilerService,
    AiModelOpsService,
    ProviderAccountReconciler,
    ProviderRegistry,
    ProviderCapacityRuntimeService,

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

    // Provider: Alibaba Model Studio / Bailian
    BailianConfigService,
    BailianCatalogService,
    BailianClient,
    BailianProviderAdapter,

    // Provider: Replicate
    ReplicateConfigService,
    ReplicateCatalogService,
    ReplicateClient,
    ReplicateProviderAdapter,

    // Provider: BytePlus ModelArk
    BytePlusConfigService,
    BytePlusCatalogService,
    BytePlusClient,
    BytePlusProviderAdapter,
  ],
  exports: [],
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
    private readonly bailian: BailianProviderAdapter,
    private readonly replicate: ReplicateProviderAdapter,
    private readonly bytePlus: BytePlusProviderAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.foundry);
    this.registry.register(this.fal);
    this.registry.register(this.bailian);
    this.registry.register(this.replicate);
    this.registry.register(this.bytePlus);
  }
}
