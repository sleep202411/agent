import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { WorldModelProviderKey } from '@repo/shared';
import {
  WORLD_MODEL_PROVIDERS,
  type WorldModelProvider,
} from './world-model-provider';

@Injectable()
export class WorldModelProviderRegistry {
  private readonly providers: ReadonlyMap<
    WorldModelProviderKey,
    WorldModelProvider
  >;

  constructor(
    @Inject(WORLD_MODEL_PROVIDERS)
    providerList: readonly WorldModelProvider[],
  ) {
    const providers = new Map<WorldModelProviderKey, WorldModelProvider>();
    for (const provider of providerList) {
      if (providers.has(provider.key)) {
        throw new Error(`Duplicate world model provider: ${provider.key}`);
      }
      providers.set(provider.key, provider);
    }
    this.providers = providers;
  }

  list(): WorldModelProvider[] {
    return [...this.providers.values()];
  }

  require(key: WorldModelProviderKey): WorldModelProvider {
    const provider = this.providers.get(key);
    if (!provider) {
      throw new NotFoundException({
        code: 'WORLD_MODEL_PROVIDER_NOT_FOUND',
        message: `World model provider "${key}" is not registered.`,
      });
    }
    return provider;
  }
}
