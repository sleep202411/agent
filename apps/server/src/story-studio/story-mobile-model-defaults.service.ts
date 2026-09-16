import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { AiJobType } from '../ai-generation/types';
import { AiCanonicalCatalogService } from '../ai-generation/canonical-catalog.service';

/**
 * Region-owned mobile (H5) generation defaults.
 *
 * The mobile_h5 experience does not accept a model choice — it always uses
 * these two env-configured defaults. They are REQUIRED, region-owned deploy
 * facts, never code assumptions: a hardcoded fallback once pointed mobile
 * video at a canonical that did not exist in the CN catalog, and every
 * mobile video quote failed with DEFAULT_MODEL_UNAVAILABLE at the user.
 *
 * Fail-loud contract (mirrors LEGACY_OSS_BASE_URL): a missing env, a default
 * that is not in this deployment's catalog, or a default whose provider
 * credential is absent must abort server boot — not surface as a user-facing
 * quote error hours later.
 */

/** Credential env per provider id. google-vertex authenticates via workload
 * identity and carries no key env. Extend as providers are added. */
const PROVIDER_KEY_ENV: Readonly<Record<string, string>> = {
  'fal-ai': 'FAL_API_KEY',
  'aliyun-bailian': 'BAILIAN_API_KEY',
  'byteplus-modelark': 'BYTEPLUS_MODELARK_API_KEY',
  'byteplus-seed-speech': 'BYTEPLUS_SEED_SPEECH_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  'agnes-ai': 'AGNES_API_KEY',
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required: set it to a canonical model id that exists in ` +
        `this region's catalog (deploy/helm values, server.env).`,
    );
  }
  return value;
}

/** Mobile H5 image default. Throws when unset — boot validates earlier. */
export function requiredMobileImageModelId(): string {
  return requiredEnv('AGENT_OS_MOBILE_IMAGE_MODEL');
}

/** Mobile H5 video default. Throws when unset — boot validates earlier. */
export function requiredMobileVideoModelId(): string {
  return requiredEnv('AGENT_OS_MOBILE_VIDEO_MODEL');
}

@Injectable()
export class StoryMobileModelDefaultsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StoryMobileModelDefaultsService.name);

  constructor(private readonly catalog: AiCanonicalCatalogService) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const [modelId, type] of [
      [requiredMobileImageModelId(), 'image'],
      [requiredMobileVideoModelId(), 'video'],
    ] as const) {
      await this.assertDefaultDeployable(modelId, type);
    }
    this.logger.log(
      `Mobile H5 generation defaults validated: image=${requiredMobileImageModelId()} video=${requiredMobileVideoModelId()}`,
    );
  }

  private async assertDefaultDeployable(
    modelId: string,
    type: AiJobType,
  ): Promise<void> {
    const models = await this.catalog.listModels();
    const model = models.find(
      (candidate) => candidate.id === modelId && candidate.type === type,
    );
    if (!model) {
      throw new Error(
        `Mobile ${type} default "${modelId}" is not in this deployment's ` +
          `active catalog (enabled models: ${models
            .filter((candidate) => candidate.enabled && candidate.type === type)
            .map((candidate) => candidate.id)
            .join(
              ', ',
            )}). Fix AGENT_OS_MOBILE_${type.toUpperCase()}_MODEL for this region.`,
      );
    }
    if (!model.enabled) {
      throw new Error(
        `Mobile ${type} default "${modelId}" is disabled in this deployment's catalog.`,
      );
    }
    const keyEnv = PROVIDER_KEY_ENV[model.provider];
    if (keyEnv && !process.env[keyEnv]?.trim()) {
      throw new Error(
        `Mobile ${type} default "${modelId}" routes via provider ` +
          `"${model.provider}" but ${keyEnv} is unset — the first user quote ` +
          `would fail with PROVIDER_NOT_CONFIGURED.`,
      );
    }
  }
}
