import { Injectable } from '@nestjs/common';
import { FoundryCatalogService } from './catalog.service';
import { FoundrySchemaFactory } from './schema.factory';
import type { FoundryModelDefinition } from '../../types';

/**
 * Azure's `/v1/models` endpoint lists every model the *resource* knows
 * about, not just the ones the team has actually deployed. Without a
 * whitelist the UI would show 20+ models that 403 on call. Set
 * `FOUNDRY_MODEL_ALLOWLIST` to a comma-separated list of deployment
 * names (e.g. `gpt-image-2,sora-2`) to filter; leave unset to allow
 * everything (useful before allowlist envs are configured per env).
 */
function parseAllowlist(): Set<string> | null {
  const raw = (process.env.FOUNDRY_MODEL_ALLOWLIST ?? '').trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
}

@Injectable()
export class FoundrySchemaRegistry {
  constructor(
    private readonly catalog: FoundryCatalogService,
    private readonly schemaFactory: FoundrySchemaFactory,
  ) {}

  async listModels(): Promise<FoundryModelDefinition[]> {
    const deployments = await this.catalog.listDeployments();
    const built = deployments
      .map((deployment) => this.schemaFactory.buildModel(deployment))
      .filter((model): model is FoundryModelDefinition => Boolean(model));

    // Dedupe by deployment name. Multiple catalog sources (env override,
    // foundry-project deployments, openai-models listing) can each
    // surface the same deployment under different record ids; the user
    // should never see the same model twice in the picker.
    const byDeployment = new Map<string, FoundryModelDefinition>();
    for (const model of built) {
      if (!byDeployment.has(model.deployment)) {
        byDeployment.set(model.deployment, model);
      }
    }
    let models = Array.from(byDeployment.values());

    const allow = parseAllowlist();
    if (allow) {
      models = models.filter((m) => allow.has(m.deployment.toLowerCase()));
    }

    if (models.length > 0) return this.sortModels(models);
    // No self-emitted seed fallback. The runtime catalog is canonical-
    // model-driven (see AiCanonicalCatalogService): Foundry only
    // contributes models when a real AiProviderModelBinding with
    // provider='microsoft-foundry' points at a canonical. Emitting a
    // hardcoded gpt-image-2/sora-2 here used to duplicate the PG
    // canonical in the picker and could shadow a real fal binding at
    // routing time, so it is intentionally removed.
    return [];
  }

  async getModel(modelId: string): Promise<FoundryModelDefinition | null> {
    const models = await this.listModels();
    return (
      models.find(
        (model) =>
          model.id === modelId ||
          model.deployment === modelId ||
          `foundry/${model.deployment}` === modelId,
      ) ?? null
    );
  }

  private sortModels(models: FoundryModelDefinition[]) {
    return [...models].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'image' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
}
