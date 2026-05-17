/**
 * FoundryProviderAdapter — Azure AI Foundry / OpenAI-compatible.
 *
 * Implements the ProviderAdapter contract for synchronous image
 * generation against Azure OpenAI (`/openai/v1/images/generations`).
 * No polling, no webhook — `startGeneration` returns `kind: 'completed'`
 * with the inline base64 bytes.
 *
 * Foundry has no model-schema endpoint; per-model schemas are hand-
 * written here in `schema.factory.ts` (vs fal.ai's auto-discovery).
 * `listModels()` returns whatever the catalog service finds in the
 * Azure resource intersected with the allowlist env.
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  AiModelDefinition,
  ProviderAdapter,
  ProviderGenerationContext,
  RawProviderOutput,
  StartResult,
} from '../../provider-adapter';
import type { AiJobError } from '../../types';
import { mapFoundryProviderRequest } from './request.mapper';
import { FoundrySchemaRegistry } from './schema.registry';

const PROVIDER_TIMEOUT_MS = 240_000;

// Tiny 1×1 transparent PNG — used by the FOUNDRY_DEBUG_DELAY_MS stub
// path. Real bytes (not a string URL) so the rest of the worker's
// upload → OSS pipeline runs end-to-end exactly like a real job.
const STUB_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

interface FoundryImageResponseBody {
  data?: Array<{ b64_json?: string; url?: string }>;
}

class FoundryProviderError extends Error {
  constructor(public readonly payload: AiJobError) {
    super(payload.message);
  }
}

@Injectable()
export class FoundryProviderAdapter implements ProviderAdapter {
  readonly provider = 'microsoft-foundry';
  private readonly logger = new Logger(FoundryProviderAdapter.name);
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;

  constructor(private readonly schemaRegistry: FoundrySchemaRegistry) {
    this.baseUrl =
      (process.env.AZURE_OPENAI_BASE_URL ?? '').replace(/\/+$/, '') || null;
    this.apiKey = process.env.AZURE_OPENAI_API_KEY ?? null;
  }

  listModels(): Promise<AiModelDefinition[]> {
    return this.schemaRegistry.listModels();
  }

  getModel(modelId: string): Promise<AiModelDefinition | null> {
    return this.schemaRegistry.getModel(modelId);
  }

  normalizeInput(
    _model: AiModelDefinition,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    // The generic AiGenerationValidatorService already normalizes per
    // the model's input_schema before reaching here. Foundry has no
    // additional cross-field rules at this layer; future ones (e.g.
    // "reference_images requires images.edit endpoint") plug in here.
    return input;
  }

  async startGeneration(
    modelId: string,
    input: Record<string, unknown>,
    ctx: ProviderGenerationContext,
  ): Promise<StartResult> {
    if (!this.baseUrl || !this.apiKey) {
      throw this.makeError(
        'PROVIDER_NOT_CONFIGURED',
        'AZURE_OPENAI_BASE_URL / AZURE_OPENAI_API_KEY unset',
      );
    }
    const model = await this.schemaRegistry.getModel(modelId);
    if (!model) {
      throw this.makeError('VALIDATION_ERROR', `Model ${modelId} not found`);
    }
    if (model.type !== 'image') {
      throw this.makeError(
        'VALIDATION_ERROR',
        'Foundry adapter only supports image generation today',
      );
    }

    const mapped = mapFoundryProviderRequest(model, input, {
      userId: ctx.userId,
    });
    // Schema doesn't carry `model` (that names a Foundry deployment,
    // not a user-facing field). Inject so Azure routes to the right
    // deployment.
    mapped.body.model = model.deployment;

    // Dev-only stub: when FOUNDRY_DEBUG_DELAY_MS is set, skip the
    // Azure call entirely, sleep that long, and return a placeholder
    // image. Lets us test queue mechanics + UI flow without burning
    // Azure quota and without 50s round-trips.
    const debugDelay = Number(process.env.FOUNDRY_DEBUG_DELAY_MS ?? 0);
    if (debugDelay > 0) {
      await new Promise((r) => setTimeout(r, debugDelay));
      const stubBuffer = STUB_PNG_BYTES;
      const { width, height } = parseSize(
        typeof mapped.body.size === 'string' ? mapped.body.size : null,
      );
      const n = Number(mapped.body.n ?? 1) || 1;
      const outputs: RawProviderOutput[] = Array.from(
        { length: n },
        (_, i) => ({
          index: i,
          buffer: stubBuffer,
          mimeType: 'image/png',
          ext: 'png',
          width,
          height,
        }),
      );
      return { kind: 'completed', outputs };
    }

    // Schema declares multipart for gpt-image-2 at the binding level,
    // but Azure's `images.generations` only reads `model` from a JSON
    // body (multipart fields are ignored, triggering NoModelName).
    // Only `images.edits` actually needs multipart for the upload.
    const contentType: 'application/json' | 'multipart/form-data' =
      mapped.endpoint === 'images.edit'
        ? 'multipart/form-data'
        : 'application/json';

    const url = this.resolveUrl(mapped.endpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(contentType, model.deployment),
        body: this.buildBody(contentType, mapped.body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw this.makeError(
          'PROVIDER_TIMEOUT',
          `provider timed out after ${PROVIDER_TIMEOUT_MS}ms`,
        );
      }
      throw this.makeError(
        'UNKNOWN',
        err instanceof Error ? err.message : 'provider fetch failed',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw this.makeError(
        response.status === 429
          ? 'PROVIDER_429'
          : response.status >= 500
            ? 'PROVIDER_5XX'
            : 'VALIDATION_ERROR',
        `provider HTTP ${response.status}: ${raw.slice(0, 400)}`,
        response.status === 429
          ? 'The image service is busy. Please try again in a moment.'
          : response.status >= 500
            ? 'The image service is temporarily unavailable.'
            : 'The image request was rejected.',
      );
    }

    const body = (await response.json()) as FoundryImageResponseBody;
    // Pass the *sent* body (which has the composed `size`) instead of
    // the raw `input` — the new schema splits the user-facing form into
    // `aspect_ratio` + `resolution_tier`, so `input.size` is undefined
    // and only `mapped.body.size` reflects what Azure actually rendered.
    const outputs = this.collectOutputs(mapped.body, body);
    if (outputs.length === 0) {
      throw this.makeError('UNKNOWN', 'Provider returned no image outputs');
    }
    return { kind: 'completed', outputs };
  }

  // pollStatus / parseWebhook — not implemented. Foundry image is
  // synchronous; if/when we add Foundry video (async job), they land
  // on this same class.

  mapError(err: unknown): AiJobError {
    if (err instanceof FoundryProviderError) return err.payload;
    return {
      code: 'UNKNOWN',
      message: err instanceof Error ? err.message : String(err),
      userMessage: 'Generation failed. Please try again.',
      retryable: true,
      createdAt: new Date().toISOString(),
    };
  }

  // ─── helpers ──────────────────────────────────────────────────

  private collectOutputs(
    input: Record<string, unknown>,
    body: FoundryImageResponseBody,
  ): RawProviderOutput[] {
    const items = Array.isArray(body?.data) ? body.data : [];
    const size = typeof input.size === 'string' ? (input.size as string) : null;
    const { width, height } = parseSize(size);
    const collected: RawProviderOutput[] = [];
    items.forEach((item, i) => {
      if (item.b64_json) {
        collected.push({
          index: i,
          buffer: Buffer.from(item.b64_json, 'base64'),
          mimeType: 'image/png',
          ext: 'png',
          width,
          height,
        });
        return;
      }
      if (item.url) {
        collected.push({
          index: i,
          providerUrl: item.url,
          mimeType: 'image/png',
          ext: 'png',
          width,
          height,
        });
      }
    });
    return collected;
  }

  private resolveUrl(endpoint: string): string {
    // The schema names endpoints by their OpenAI-SDK method (e.g.
    // `images.generate`). Translate to the HTTP path under
    // AZURE_OPENAI_BASE_URL (which already includes `/openai/v1`).
    const path = (() => {
      switch (endpoint) {
        case 'images.generate':
          return '/images/generations';
        case 'images.edit':
          return '/images/edits';
        case 'videos.create':
          return '/videos/generations/jobs';
        default:
          return `/${endpoint.replace(/\./g, '/')}`;
      }
    })();
    return `${this.baseUrl}${path}`;
  }

  private buildHeaders(
    contentType: 'application/json' | 'multipart/form-data',
    deployment: string,
  ): Record<string, string> {
    // Azure OpenAI accepts both `api-key` and `Authorization: Bearer`.
    // `x-ms-model-mesh-model-name` is the model-router fallback when
    // body parsing misses `model` (e.g. multipart edits).
    const headers: Record<string, string> = {
      'api-key': this.apiKey!,
      Authorization: `Bearer ${this.apiKey}`,
      'x-ms-model-mesh-model-name': deployment,
    };
    if (contentType === 'application/json') {
      headers['Content-Type'] = 'application/json';
    }
    // multipart: leave Content-Type unset so fetch + FormData inject
    // the boundary correctly.
    return headers;
  }

  private buildBody(
    contentType: 'application/json' | 'multipart/form-data',
    payload: Record<string, unknown>,
  ): BodyInit {
    if (contentType === 'application/json') {
      return JSON.stringify(payload);
    }
    const form = new FormData();
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) form.append(`${key}[]`, String(item));
      } else if (typeof value === 'object') {
        form.append(key, JSON.stringify(value));
      } else {
        form.append(key, String(value));
      }
    }
    return form;
  }

  private makeError(
    code: AiJobError['code'],
    message: string,
    userMessage = 'Generation failed. Please try again.',
  ): FoundryProviderError {
    return new FoundryProviderError({
      code,
      message,
      userMessage,
      retryable: [
        'PROVIDER_429',
        'PROVIDER_5XX',
        'PROVIDER_TIMEOUT',
        'UNKNOWN',
      ].includes(code),
      createdAt: new Date().toISOString(),
    });
  }
}

function parseSize(size: string | null): { width?: number; height?: number } {
  if (!size || size === 'auto') return {};
  const m = size.match(/^(\d+)x(\d+)$/i);
  if (!m) return {};
  return { width: Number(m[1]), height: Number(m[2]) };
}
