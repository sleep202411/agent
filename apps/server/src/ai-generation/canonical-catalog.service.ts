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
 * Provider adapters whose definitions are NOT PG-binding-driven (Azure
 * Foundry self-emits hardcoded schemas) are never used to source the
 * catalog. Foundry stays a generation PROVIDER: if a real
 * `AiProviderModelBinding` with `provider='microsoft-foundry'` is ever
 * created it would route through here exactly like fal/bailian. Today
 * none exists, so Foundry contributes zero catalog entries.
 *
 * INVARIANT (keeps submit/routing working): the emitted
 * `AiModelDefinition.id === AiCanonicalModel.slug`. Routing resolves a
 * submitted modelId via `adapter.getModel(slug)` and the worker runs
 * `startGeneration(selectedModelId=slug)`, so the catalog must keep
 * emitting the canonical slug as the id — which the provider catalog
 * services already do.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/db/db.module';
import { FalCatalogService } from './providers/fal/fal-catalog.service';
import { BailianCatalogService } from './providers/bailian/bailian-catalog.service';
import { ReplicateCatalogService } from './providers/replicate/replicate-catalog.service';
import { BytePlusCatalogService } from './providers/byteplus/byteplus-catalog.service';
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
    private readonly replicate: ReplicateCatalogService,
    private readonly bytePlus: BytePlusCatalogService,
  ) {
    this.catalogByProvider = {
      'fal-ai': this.fal,
      'byteplus-modelark': this.bytePlus,
      'aliyun-bailian': this.bailian,
      replicate: this.replicate,
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
        models.push({
          model,
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

function uiSortOrder(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Number.MAX_SAFE_INTEGER;
  }
  const raw = (value as Record<string, unknown>).sortOrder;
  return typeof raw === 'number' && Number.isFinite(raw)
    ? raw
    : Number.MAX_SAFE_INTEGER;
}
