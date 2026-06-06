/**
 * AiCanonicalCatalogService — the single source of truth for the
 * runtime model catalog.
 *
 * The control plane (`AiCanonicalModel`) is canonical: the catalog is
 * exactly the list of VISIBLE + ACTIVE canonical models, ONE entry per
 * canonical. There is no provider fan-out and no provider-merge:
 *
 *   1. Query the visible/active `AiCanonicalModel` rows, joined to their
 *      ACTIVE provider bindings ordered by route priority (asc) → weight
 *      (desc) → endpointId. `bindings[0]` is the PRIMARY active binding.
 *   2. Canonical models with NO active binding (e.g. `midjourney-v7`,
 *      `minimax-image`) cannot generate — every part of the
 *      AiModelDefinition (input_schema, provider, deployment, pricing,
 *      ops) is assembled from the primary binding — so they are EXCLUDED
 *      from the runtime catalog.
 *   3. The primary binding is assembled into an AiModelDefinition by the
 *      provider's own binding-driven catalog service (fal / bailian).
 *      Those services already collapse to one definition per canonical
 *      (keyed by `canonicalModel.slug`) and already carry `ops`,
 *      `deployment = endpointId`, and pricing from
 *      `binding.unitPriceNanoUsd/unitType + canonicalModel.marginBps`.
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
  ) {
    this.catalogByProvider = {
      'fal-ai': this.fal,
      'aliyun-bailian': this.bailian,
    };
  }

  /**
   * The canonical-driven catalog: one AiModelDefinition per visible +
   * active canonical model that has at least one active provider
   * binding, assembled from that canonical's PRIMARY active binding.
   */
  async listModels(): Promise<AiModelDefinition[]> {
    const canonicals = await this.prisma.aiCanonicalModel.findMany({
      where: {
        status: 'active',
        visibility: 'direct',
        archivedAt: null,
      },
      include: {
        bindings: {
          where: {
            status: 'active',
            archivedAt: null,
            providerAccount: { status: 'active', archivedAt: null },
          },
          // Same ordering the provider catalogs use: the survivor is the
          // primary (highest-priority) binding per canonical.
          orderBy: [
            { priority: 'asc' },
            { weight: 'desc' },
            { endpointId: 'asc' },
          ],
          take: 1,
          select: { provider: true },
        },
      },
      orderBy: [{ family: 'asc' }, { modality: 'asc' }, { slug: 'asc' }],
    });

    const models: AiModelDefinition[] = [];
    for (const canonical of canonicals) {
      const primary = canonical.bindings[0];
      // Canonical-only model (no active binding) — cannot generate.
      // Excluded from the runtime catalog: there is no provider /
      // endpoint / schema / price to assemble and routing.resolve would
      // MODEL_NOT_FOUND on submit.
      if (!primary) continue;

      const catalog = this.catalogByProvider[primary.provider];
      if (!catalog) {
        // A binding points at a provider that has no binding-driven
        // catalog service registered here. Skip rather than fall back to
        // any self-emitted definition.
        this.logger.warn(
          `Canonical "${canonical.slug}" primary binding uses provider ` +
            `"${primary.provider}" which has no binding-driven catalog; skipping.`,
        );
        continue;
      }

      // The provider catalog already collapses to the primary binding
      // and emits the definition keyed by the canonical slug, carrying
      // ops + deployment + pricing. Resolving by slug returns exactly
      // that primary-binding definition.
      const model = await catalog.getModel(canonical.slug);
      if (!model) {
        this.logger.warn(
          `Canonical "${canonical.slug}" has an active ${primary.provider} ` +
            `binding but its catalog produced no definition; skipping.`,
        );
        continue;
      }
      models.push(model);
    }

    return models;
  }
}
