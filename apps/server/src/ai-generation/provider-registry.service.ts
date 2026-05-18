/**
 * ProviderRegistry — dispatch hub for AI providers.
 *
 * Holds one adapter instance per provider name. Worker / service /
 * webhook controller all go through `get(provider)` to find the right
 * adapter for a given job; nobody else imports adapter classes
 * directly.
 *
 * Adapters self-register on module init (their Nest modules call
 * `registry.register(adapter)`). This keeps the registry agnostic of
 * which providers are wired in the current build — turning a provider
 * off = drop its module from `AiGenerationModule.imports`.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { ProviderAdapter } from './provider-adapter';

@Injectable()
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.provider)) {
      throw new Error(
        `ProviderAdapter for "${adapter.provider}" already registered`,
      );
    }
    this.adapters.set(adapter.provider, adapter);
  }

  /** Strict lookup — throws if the provider isn't registered. */
  get(provider: string): ProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new NotFoundException({
        code: 'PROVIDER_NOT_REGISTERED',
        msg: `No adapter for provider "${provider}"`,
      });
    }
    return adapter;
  }

  /** Loose lookup — used by /aurora/ai/models to skip missing providers. */
  tryGet(provider: string): ProviderAdapter | null {
    return this.adapters.get(provider) ?? null;
  }

  /** Enumerate all registered providers — useful for model listing fanout. */
  list(): ProviderAdapter[] {
    return Array.from(this.adapters.values());
  }
}
