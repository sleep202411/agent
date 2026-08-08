/**
 * AiCanonicalCatalogService — the single source of truth for the
 * runtime model catalog.
 *
 * The control plane (`AiCanonicalModel`) is canonical: the catalog is
 * exactly the list of ACTIVE canonical models, ONE entry per
 * canonical. There is no provider fan-out and no provider-merge:
 *
 *   1. Query the active `AiCanonicalModel` rows, joined to their
 *      ACTIVE provider bindings ordered by route priority (asc) → weight
 *      (desc) → endpointId.
 *   2. Canonical models with NO active binding cannot generate — every part
 *      of the AiModelDefinition (input_schema, provider, deployment, ops) is
 *      assembled from the primary binding — so they are EXCLUDED from the
 *      runtime catalog.
 *   3. The primary binding is assembled into an AiModelDefinition by the
 *      provider's own binding-driven catalog service (fal / bailian).
 *      Those services already collapse to one definition per canonical
 *      (keyed by `canonicalModel.slug`) and already carry `ops`,
 *      `deployment = endpointId`. User-facing pricing comes from
 *      `AiCanonicalModel.billingPolicy.productPricing`; provider request cost
 *      is recorded later per job only when the provider reports usage/cost.
 *
 * Bindings whose provider has no registered adapter are skipped (warn) until
 * re-bound to an active provider in AI_PROVIDER_KEYS.
 *
 * INVARIANT (keeps submit/routing working): the emitted
 * `AiModelDefinition.id === AiCanonicalModel.slug`. Routing resolves a
 * submitted modelId via `adapter.getModel(slug)` and the worker runs
 * `startGeneration(selectedModelId=slug)`, so the catalog must keep
 * emitting the canonical slug as the id — which the provider catalog
 * services already do.
 */
import { Injectable, Logger } from '@nestjs/common';
import { withAttachedUiOptions } from '@repo/shared';
import { PrismaService } from '../infra/db/db.module';
import { FalCatalogService } from './providers/fal/fal-catalog.service';
import { BailianCatalogService } from './providers/bailian/bailian-catalog.service';
import { BytePlusCatalogService } from './providers/byteplus/byteplus-catalog.service';
import { AgnesCatalogService } from './providers/agnes/agnes-catalog.service';
import { MiniMaxCatalogService } from './providers/minimax/minimax-catalog.service';
import type { AiModelDefinition } from './types';

/**
 * The narrow contract the canonical catalog needs from each PG-binding-
 * driven provider catalog service. Both FalCatalogService and
 * BailianCatalogService already implement this — they resolve a
 * canonical slug to its primary-binding AiModelDefinition.
 */
interface BindingDrivenCatalog {
  getModel(modelId: string): Promise<AiModelDefinition | null>;
}

@Injectable()
export class AiCanonicalCatalogService {
  private readonly logger = new Logger(AiCanonicalCatalogService.name);

  /**
   * provider column value → its binding-driven catalog service.
   * Adding a new PG-binding-driven provider = register it here.
   */
  private readonly catalogByProvider: Record<string, BindingDrivenCatalog>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fal: FalCatalogService,
    private readonly bailian: BailianCatalogService,
    private readonly bytePlus: BytePlusCatalogService,
    private readonly agnes: AgnesCatalogService,
    private readonly minimax: MiniMaxCatalogService,
  ) {
    this.catalogByProvider = {
      'fal-ai': this.fal,
      'byteplus-modelark': this.bytePlus,
      'aliyun-bailian': this.bailian,
      'agnes-ai': this.agnes,
      minimax: this.minimax,
    };
  }

  /**
   * The canonical-driven catalog: one AiModelDefinition per active canonical
   * model that has at least one active provider binding, assembled from that
   * canonical's PRIMARY active binding.
   */
  async listModels(): Promise<AiModelDefinition[]> {
    const canonicals = await this.prisma.aiCanonicalModel.findMany({
      where: {
        status: 'active',
        archivedAt: null,
      },
      include: {
        bindings: {
          where: {
            status: 'active',
            archivedAt: null,
            providerAccount: { status: 'active', archivedAt: null },
          },
          orderBy: [
            { priority: 'asc' },
            { weight: 'desc' },
            { endpointId: 'asc' },
          ],
          select: { provider: true },
        },
      },
      orderBy: [{ family: 'asc' }, { modality: 'asc' }, { slug: 'asc' }],
    });

    const models: Array<{
      model: AiModelDefinition;
      sortOrder: number;
      slug: string;
    }> = [];
    for (const canonical of canonicals) {
      // Canonical-only model (no active binding) — cannot generate.
      // Excluded from the runtime catalog: there is no provider /
      // endpoint / schema to assemble and routing.resolve would
      // MODEL_NOT_FOUND on submit.
      if (canonical.bindings.length === 0) continue;

      const candidates: AiModelDefinition[] = [];
      for (const binding of canonical.bindings) {
        const catalog = this.catalogByProvider[binding.provider];
        if (!catalog) {
          this.logger.warn(
            `Canonical "${canonical.slug}" binding uses provider ` +
              `"${binding.provider}" which has no binding-driven catalog; skipping provider.`,
          );
          continue;
        }

        const model = await catalog.getModel(canonical.slug);
        if (!model) {
          this.logger.warn(
            `Canonical "${canonical.slug}" has an active ${binding.provider} ` +
              `binding but its catalog produced no definition; skipping provider.`,
          );
          continue;
        }
        candidates.push(model);
        if (model.enabled) break;
      }

      const model = candidates.find((item) => item.enabled) ?? candidates[0];
      if (model) {
        // `vendor` lives on the canonical row, but provider mappers build the
        // AiModelDefinition without ever reading the canonical — so graft it on
        // here (same seam as withCanonicalUiPolicy) or it never reaches the wire.
        // Graft canonical vendor + UI policy + x-ui.options onto the provider definition.
        const withCanonicalFields: AiModelDefinition = {
          ...finalizeCatalogModel(model, canonical.uiPolicy),
          ...(canonical.vendor ? { vendor: canonical.vendor } : {}),
        };
        models.push({
          model: withCanonicalFields,
          sortOrder: uiSortOrder(canonical.uiPolicy),
          slug: canonical.slug,
        });
      }
    }

    return models
      .sort((a, b) => {
        const order = a.sortOrder - b.sortOrder;
        if (order !== 0) return order;
        return a.slug.localeCompare(b.slug);
      })
      .map((item) => item.model);
  }
}

/**
 * Product catalog boundary: merge canonical UI policy + ensure every
 * user-visible enum carries `x-ui.options` (label/value first-class).
 */
function finalizeCatalogModel(
  model: AiModelDefinition,
  canonicalUiPolicy: unknown,
): AiModelDefinition {
  return withAttachedUiOptions(withCanonicalUiPolicy(model, canonicalUiPolicy));
}

function withCanonicalUiPolicy(
  model: AiModelDefinition,
  canonicalUiPolicy: unknown,
): AiModelDefinition {
  const canonical = recordValue(canonicalUiPolicy);
  if (!canonical) return model;
  const defaultMode = model.ui_policy?.defaultMode ?? 'simple';
  return {
    ...model,
    ui_policy: {
      ...(model.ui_policy ?? {}),
      ...(typeof canonical.group === 'string'
        ? { group: canonical.group }
        : {}),
      ...(typeof canonical.recommended === 'boolean'
        ? { recommended: canonical.recommended }
        : {}),
      ...(typeof canonical.sortOrder === 'number' &&
      Number.isFinite(canonical.sortOrder)
        ? { sortOrder: canonical.sortOrder }
        : {}),
      defaultMode,
    },
  };
}

function uiSortOrder(value: unknown): number {
  const raw = recordValue(value)?.sortOrder;
  return typeof raw === 'number' && Number.isFinite(raw)
    ? raw
    : Number.MAX_SAFE_INTEGER;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
