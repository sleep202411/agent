import { Module, type OnModuleInit } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { CharactersModule } from '../characters/characters.module';
import { REAL_PERSON_JOB_CANCELLER } from '../characters/ports/real-person-job-canceller';
import { REAL_PERSON_LIKENESS_OUTPUTS } from '../characters/ports/real-person-likeness-outputs';
import { RealPersonLikenessOutputsService } from './real-person-likeness-outputs.service';
import { RealtimeModule } from '../infra/realtime/realtime.module';
import { StorageModule } from '../infra/storage/storage.module';
import { EntitlementsModule } from '../entitlements';
import { WorkspacesModule } from '../workspaces';
import { MediaModule } from '../media/media.module';
import { DocumentsModule } from '../documents/documents.module';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { ProjectSkillsModule } from '../project-skills';
import { AiModelOpsController } from './admin/ai-model-ops.controller';
import { AiModelOpsService } from './admin/ai-model-ops.service';
import { AiGenerationController } from './ai-generation.controller';
import { AiGenerationService } from './ai-generation.service';
import { AiGenerationBillingRecoveryService } from './billing-recovery.service';
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
import { FalCatalogService } from './providers/fal/fal-catalog.service';
import { FalClient } from './providers/fal/fal-client';
import { FalConfigService } from './providers/fal/fal-config.service';
import { FalProviderAdapter } from './providers/fal/fal-provider.adapter';
import { BailianCatalogService } from './providers/bailian/bailian-catalog.service';
import { BailianClient } from './providers/bailian/bailian-client';
import { BailianConfigService } from './providers/bailian/bailian-config.service';
import { BailianProviderAdapter } from './providers/bailian/bailian-provider.adapter';
import { BytePlusCatalogService } from './providers/byteplus/byteplus-catalog.service';
import { BytePlusClient } from './providers/byteplus/byteplus-client';
import { BytePlusConfigService } from './providers/byteplus/byteplus-config.service';
import { BytePlusProviderAdapter } from './providers/byteplus/byteplus-provider.adapter';
import { BytePlusReferencePreparerService } from './providers/byteplus/byteplus-reference-preparer.service';
import { AgnesCatalogService } from './providers/agnes/agnes-catalog.service';
import { AgnesClient } from './providers/agnes/agnes-client';
import { AgnesConfigService } from './providers/agnes/agnes-config.service';
import { AgnesProviderAdapter } from './providers/agnes/agnes-provider.adapter';
import { MiniMaxCatalogService } from './providers/minimax/minimax-catalog.service';
import { MiniMaxClient } from './providers/minimax/minimax-client';
import { MiniMaxConfigService } from './providers/minimax/minimax-config.service';
import { MiniMaxProviderAdapter } from './providers/minimax/minimax-provider.adapter';
import { GoogleVertexCatalogService } from './providers/google-vertex/google-vertex-catalog.service';
import { GoogleVertexClient } from './providers/google-vertex/google-vertex-client';
import { GoogleVertexConfigService } from './providers/google-vertex/google-vertex-config.service';
import { GoogleVertexMediaLoaderService } from './providers/google-vertex/google-vertex-media-loader.service';
import { GoogleVertexProviderAdapter } from './providers/google-vertex/google-vertex-provider.adapter';
import { BytePlusSpeechCatalogService } from './providers/byteplus-speech/byteplus-speech-catalog.service';
import { BytePlusSpeechClient } from './providers/byteplus-speech/byteplus-speech-client';
import { BytePlusSpeechConfigService } from './providers/byteplus-speech/byteplus-speech-config.service';
import { BytePlusSpeechProviderAdapter } from './providers/byteplus-speech/byteplus-speech-provider.adapter';
import { AiGenerationQueueService } from './queue.service';
import { AiGenerationRepository } from './repository';
import { AiGenerationRoutingService } from './routing.service';
import { AiGenerationValidatorService } from './validator.service';
import { AiGenerationWorkerService } from './worker.service';
import { AiReferenceUrlPreparerService } from './reference-url-preparer.service';
import { AiGenerationCompletionObserverRegistry } from './completion-observer.service';

@Module({
  imports: [
    AdminAuthModule,
    CharactersModule,
    RealtimeModule,
    StorageModule,
    EntitlementsModule,
    WorkspacesModule,
    MediaModule,
    DocumentsModule,
    StoryAccessModule,
    ProjectSkillsModule,
  ],
  controllers: [AiGenerationController, AiModelOpsController],
  providers: [
    // Generic layer
    AiGenerationService,
    AiGenerationBillingWalletService,
    AiGenerationBillingRecoveryService,
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
    AiGenerationCompletionObserverRegistry,
    AiPromptCompilerService,
    AiReferenceUrlPreparerService,
    AiModelOpsService,
    ProviderAccountReconciler,
    ProviderRegistry,
    ProviderCapacityRuntimeService,

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

    // Provider: BytePlus ModelArk
    BytePlusConfigService,
    BytePlusCatalogService,
    BytePlusClient,
    BytePlusReferencePreparerService,
    BytePlusProviderAdapter,

    // Provider: BytePlus Seed Speech (Seed Audio + Seed TTS)
    BytePlusSpeechConfigService,
    BytePlusSpeechCatalogService,
    BytePlusSpeechClient,
    BytePlusSpeechProviderAdapter,

    // Provider: Google Vertex AI (Nano Banana + Veo)
    GoogleVertexConfigService,
    GoogleVertexCatalogService,
    GoogleVertexMediaLoaderService,
    GoogleVertexClient,
    GoogleVertexProviderAdapter,

    // Provider: Agnes AI
    AgnesConfigService,
    AgnesCatalogService,
    AgnesClient,
    AgnesProviderAdapter,

    // Provider: MiniMax (H3 video)
    MiniMaxConfigService,
    MiniMaxCatalogService,
    MiniMaxClient,
    MiniMaxProviderAdapter,

    // v2: bind the character job-cancellation port to the generation service.
    // Characters resolves it lazily via ModuleRef (strict:false) to avoid a
    // module-import cycle — see CharacterGrantService.
    { provide: REAL_PERSON_JOB_CANCELLER, useExisting: AiGenerationService },
    // v2 §6: subject likeness output visibility + takedown bridge.
    RealPersonLikenessOutputsService,
    {
      provide: REAL_PERSON_LIKENESS_OUTPUTS,
      useExisting: RealPersonLikenessOutputsService,
    },
  ],
  exports: [
    AiGenerationService,
    AiGenerationCompletionObserverRegistry,
    // Canonical catalog access for cross-module boot-time validation (e.g.
    // the Story mobile-default readiness check) — request paths keep using
    // AiGenerationService.listCatalog for per-user access stamping.
    AiCanonicalCatalogService,
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
    private readonly fal: FalProviderAdapter,
    private readonly bailian: BailianProviderAdapter,
    private readonly bytePlus: BytePlusProviderAdapter,
    private readonly bytePlusSpeech: BytePlusSpeechProviderAdapter,
    private readonly googleVertex: GoogleVertexProviderAdapter,
    private readonly agnes: AgnesProviderAdapter,
    private readonly minimax: MiniMaxProviderAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.fal);
    this.registry.register(this.bailian);
    this.registry.register(this.bytePlus);
    this.registry.register(this.bytePlusSpeech);
    this.registry.register(this.googleVertex);
    this.registry.register(this.agnes);
    this.registry.register(this.minimax);
  }
}
