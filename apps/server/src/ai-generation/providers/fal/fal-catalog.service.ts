import { Injectable, Logger } from '@nestjs/common';
import type { AiModelDefinition } from '../../types';
import { FalConfigService } from './fal-config.service';
import type { FalModelRuntimeConfig } from './fal.types';
import { toAiModelDefinition } from './fal-schema.mapper';

interface FalCatalogCache {
  expiresAt: number;
  models: AiModelDefinition[];
  runtimeByModelId: Map<string, FalModelRuntimeConfig>;
  runtimeByEndpointId: Map<string, FalModelRuntimeConfig>;
}

@Injectable()
export class FalCatalogService {
  private readonly logger = new Logger(FalCatalogService.name);
  private cache: FalCatalogCache | null = null;

  constructor(private readonly configService: FalConfigService) {}

  listModels(): Promise<AiModelDefinition[]> {
    const cache = this.getCache();
    return Promise.resolve(cache.models);
  }

  getModel(modelId: string): Promise<AiModelDefinition | null> {
    const cache = this.getCache();
    return Promise.resolve(
      cache.models.find(
        (model) =>
          model.id === modelId ||
          model.deployment === modelId ||
          `fal/${model.deployment}` === modelId,
      ) ?? null,
    );
  }

  getRuntimeConfig(modelId: string): Promise<FalModelRuntimeConfig | null> {
    const cache = this.getCache();
    return Promise.resolve(
      cache.runtimeByModelId.get(modelId) ??
        cache.runtimeByEndpointId.get(modelId) ??
        cache.runtimeByModelId.get(`fal/${modelId}`) ??
        null,
    );
  }

  private getCache(): FalCatalogCache {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache;
    const config = this.configService.config;
    const runtimeByModelId = new Map<string, FalModelRuntimeConfig>();
    const runtimeByEndpointId = new Map<string, FalModelRuntimeConfig>();
    const models = config.models.map((runtime) => {
      const model = toAiModelDefinition(runtime);
      runtimeByModelId.set(model.id, runtime);
      runtimeByModelId.set(model.deployment, runtime);
      runtimeByEndpointId.set(runtime.endpointId, runtime);
      return model;
    });

    if (config.enabled && config.models.length === 0) {
      this.logger.warn(
        'FAL_ENABLED=true but no fal models are configured. Set FAL_MODEL_CONFIGS or FAL_MODEL_ALLOWLIST.',
      );
    }

    this.cache = {
      expiresAt: Date.now() + config.catalogRefreshMs,
      models,
      runtimeByModelId,
      runtimeByEndpointId,
    };
    return this.cache;
  }
}
