import { Injectable, Logger } from '@nestjs/common';
import type {
  FoundryCatalogSource,
  FoundryDeploymentRecord,
} from '../../types';

interface CatalogCache {
  expiresAt: number;
  records: FoundryDeploymentRecord[];
}

const DEFAULT_CACHE_MS = 5 * 60 * 1000;

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function pickString(
  source: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function arrayFromPayload(payload: unknown): unknown[] {
  const root = asRecord(payload);
  const value = root.value ?? root.data ?? root.items ?? root.deployments;
  return Array.isArray(value) ? value : [];
}

@Injectable()
export class FoundryCatalogService {
  private readonly logger = new Logger(FoundryCatalogService.name);
  private cache: CatalogCache | null = null;

  async listDeployments(): Promise<FoundryDeploymentRecord[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.records;

    const records = await this.discoverDeployments();
    this.cache = {
      expiresAt: now + intEnv('FOUNDRY_CATALOG_CACHE_MS', DEFAULT_CACHE_MS),
      records,
    };
    return records;
  }

  isConfigured(): boolean {
    return Boolean(
      process.env.FOUNDRY_DEPLOYMENTS_JSON?.trim() ||
      process.env.AZURE_FOUNDRY_PROJECT_ENDPOINT?.trim() ||
      process.env.AZURE_OPENAI_BASE_URL?.trim(),
    );
  }

  private async discoverDeployments(): Promise<FoundryDeploymentRecord[]> {
    const sources = [
      () => this.fromEnvOverrides(),
      () => this.fromFoundryProject(),
      () => this.fromOpenAIModels(),
    ];

    const merged = new Map<string, FoundryDeploymentRecord>();
    for (const source of sources) {
      try {
        for (const record of await source()) {
          merged.set(record.id, record);
        }
      } catch (error) {
        this.logger.warn(
          `Foundry catalog source failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return Array.from(merged.values()).sort((a, b) =>
      a.deployment.localeCompare(b.deployment),
    );
  }

  private async fromEnvOverrides(): Promise<FoundryDeploymentRecord[]> {
    const raw = process.env.FOUNDRY_DEPLOYMENTS_JSON?.trim();
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed) ? parsed : arrayFromPayload(parsed);
    return items
      .map((item) => this.normalizeDeployment(item, 'env-override'))
      .filter((item): item is FoundryDeploymentRecord => Boolean(item));
  }

  private async fromFoundryProject(): Promise<FoundryDeploymentRecord[]> {
    const endpoint = process.env.AZURE_FOUNDRY_PROJECT_ENDPOINT?.trim();
    if (!endpoint) return [];

    const url = new URL(`${trimTrailingSlash(endpoint)}/deployments`);
    url.searchParams.set(
      'api-version',
      process.env.AZURE_FOUNDRY_API_VERSION ?? 'v1',
    );
    url.searchParams.set('deploymentType', 'ModelDeployment');

    const response = await fetch(url, {
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`project deployments returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    return arrayFromPayload(payload)
      .map((item) => this.normalizeDeployment(item, 'foundry-project'))
      .filter((item): item is FoundryDeploymentRecord => Boolean(item));
  }

  private async fromOpenAIModels(): Promise<FoundryDeploymentRecord[]> {
    const baseUrl = process.env.AZURE_OPENAI_BASE_URL?.trim();
    if (!baseUrl) return [];

    const response = await fetch(`${trimTrailingSlash(baseUrl)}/models`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`openai models returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    return arrayFromPayload(payload)
      .map((item) => this.normalizeOpenAIModel(item))
      .filter((item): item is FoundryDeploymentRecord => Boolean(item));
  }

  private normalizeOpenAIModel(raw: unknown): FoundryDeploymentRecord | null {
    const source = asRecord(raw);
    const id = pickString(source, ['id', 'model', 'name']);
    if (!id) return null;
    return {
      id: `openai:${id}`,
      deployment: id,
      modelName: id,
      displayName: id,
      source: 'openai-models',
      raw,
    };
  }

  private normalizeDeployment(
    raw: unknown,
    sourceName: FoundryCatalogSource,
  ): FoundryDeploymentRecord | null {
    const source = asRecord(raw);
    const properties = asRecord(source.properties);
    const model = asRecord(properties.model ?? source.model);
    const sku = asRecord(source.sku);

    const deployment = pickString(source, ['name', 'deploymentName', 'id']);
    const modelName =
      pickString(model, ['name', 'modelName', 'id']) ??
      pickString(properties, ['modelName', 'model']) ??
      deployment;
    if (!deployment || !modelName) return null;

    const publisher =
      pickString(model, ['publisher', 'modelPublisher']) ??
      pickString(properties, ['modelPublisher', 'publisher']);
    const modelVersion =
      pickString(model, ['version', 'modelVersion']) ??
      pickString(properties, ['modelVersion', 'version']);
    const displayName =
      pickString(source, ['displayName']) ??
      pickString(properties, ['displayName']) ??
      deployment;
    const description =
      pickString(source, ['description']) ??
      pickString(properties, ['description']) ??
      (publisher ? `${publisher} ${modelName}` : modelName);

    return {
      id: `${sourceName}:${deployment}`,
      deployment,
      modelName,
      modelVersion,
      publisher,
      displayName,
      description: sku.name ? `${description} (${sku.name})` : description,
      source: sourceName,
      raw,
    };
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    const bearer = process.env.AZURE_FOUNDRY_BEARER_TOKEN?.trim();
    const apiKey =
      process.env.AZURE_FOUNDRY_API_KEY?.trim() ??
      process.env.AZURE_OPENAI_API_KEY?.trim();

    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (apiKey) headers['api-key'] = apiKey;
    return headers;
  }
}
