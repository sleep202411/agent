/**
 * CRUD + state-machine for CreatorService and its packages.
 *
 * Visibility model:
 *
 *   - Plaza (public) sees `listed` services with `deletedAt = NULL`.
 *   - A creator can see all of their own services (any status,
 *     including archived) when scoped via `creatorId = self`.
 *   - Anyone with a direct id link can read a `listed` service.
 *     `draft`/`paused`/`archived` services 404 to non-owners.
 *
 * Edit model:
 *
 *   - Only the owner can write. Other writers 403 / 404 (we 404 to
 *     avoid leaking that a draft exists at this id).
 *   - Packages are replace-all on PATCH (see dto.ts header).
 *   - `version` is the optimistic concurrency token; bumped on every
 *     owner write; checked when the client passes `expectedVersion`.
 *
 * State transitions (enforced here, not via DB CHECK because the
 * preconditions cross tables):
 *
 *   draft   → listed   (publish, requires ≥ 1 package)
 *   listed  → paused   (pause)
 *   paused  → listed   (resume)
 *   any     → archived (archive — one-way; soft-delete)
 *
 *   first publish sets `publishedAt`; subsequent pause/resume leave
 *   it alone so plaza ordering stays sticky to original list time.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CreatorService, Prisma } from '@prisma/client';
import { ZERO_DECIMAL_CURRENCIES } from '@repo/shared/crew';
import { assertAllowedCurrency } from '../common/currency';
import { newShortId } from '../common/id';
import { PrismaService } from '../infra/db/db.module';
import type {
  CreateServiceInput,
  ListServicesQuery,
  PackageInput,
  QuestionInput,
  UpdateServiceInput,
} from './dto';
import { toServiceCardDTO, toServiceDTO } from './mappers';

@Injectable()
export class CreatorServicesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Read ────────────────────────────────────────────────

  /**
   * Public listing — plaza / category browse. Only `listed`
   * services. Cursor-paginated by id (newest-published-first via
   * the `creator_services_feed_idx`).
   */
  async list(query: ListServicesQuery, viewerId: string | null = null) {
    const { creatorId, category, q, limit, cursor } = query;

    // Visibility model:
    //   - Owner browsing own services: any status, includes archived
    //     (so "All" filter on the Services tab shows drafts the user
    //     just saved, plus archived rows they may want to restore).
    //     Explicit `status` query narrows.
    //   - Anyone else: only `listed` non-archived. Listing other
    //     people's drafts is a leak.
    const isSelf = !!viewerId && !!creatorId && viewerId === creatorId;

    const statusFilter: Prisma.CreatorServiceWhereInput = isSelf
      ? query.status
        ? { status: query.status }
        : {}
      : { status: 'listed' };

    const deletedFilter: Prisma.CreatorServiceWhereInput = isSelf
      ? // Owner sees archived too; narrow only when they pick the
        // 'archived' filter explicitly (deletedAt is non-null in that
        // case anyway, so the status filter alone is sufficient).
        {}
      : { deletedAt: null };

    const where: Prisma.CreatorServiceWhereInput = {
      ...statusFilter,
      ...deletedFilter,
      ...(creatorId ? { creatorId } : {}),
      ...(category ? { category } : {}),
      ...(q
        ? {
            // Title or tag substring match. Postgres ILIKE for case
            // folding; tags array uses `has` for exact-match.
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              { tags: { has: q.toLowerCase() } },
            ],
          }
        : {}),
    };

    // Owner view: sort by createdAt — drafts (publishedAt = NULL)
    // would otherwise sink below every listed row.
    // Public view: sort by publishedAt — preserves the "newest
    // listing first" plaza semantic.
    const orderBy: Prisma.CreatorServiceOrderByWithRelationInput[] = isSelf
      ? [{ createdAt: 'desc' }, { id: 'asc' }]
      : [{ publishedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }];

    const rows = await this.prisma.creatorService.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: { packages: true },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((s) => toServiceCardDTO(s, s.packages)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /**
   * Detail by id.
   *
   *   - Owner sees the row at any status, including `archived` — so
   *     the dialog can show the archived state right after the
   *     archive button is pressed, and the row remains addressable
   *     by id (we never hard-delete).
   *   - Non-owner only sees `listed` non-archived rows; everything
   *     else 404s so we don't leak that a draft / paused / archived
   *     service exists at this id.
   */
  async detail(
    id: string,
    viewerId: string | null = null,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const row = await db.creatorService.findUnique({
      where: { id },
      include: { packages: true, requirementQuestions: true },
    });
    if (!row) throw new NotFoundException('Service not found');
    const isOwner = !!viewerId && viewerId === row.creatorId;
    if (!isOwner) {
      if (row.deletedAt || row.status !== 'listed') {
        throw new NotFoundException('Service not found');
      }
    }
    return toServiceDTO(row, row.packages, row.requirementQuestions);
  }

  // ─── Write ───────────────────────────────────────────────

  async create(creatorId: string, input: CreateServiceInput) {
    this.assertPackagesValid(input.packages);

    const serviceId = newShortId();
    const creationKey = input.clientRequestKey ?? null;
    const creationFingerprint = creationKey
      ? createServiceFingerprint(input)
      : null;
    const row = await this.prisma.$transaction(async (tx) => {
      if (creationKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`creator-service-create:${creatorId}:${creationKey}`}, 0))`;
        const receipt = await tx.creatorService.findUnique({
          where: { creatorId_creationKey: { creatorId, creationKey } },
          select: { id: true },
        });
        if (receipt) {
          await tx.$queryRaw`SELECT id FROM creator_services WHERE id = ${receipt.id} FOR SHARE`;
          const existing = await tx.creatorService.findUniqueOrThrow({
            where: { id: receipt.id },
            include: { packages: true, requirementQuestions: true },
          });
          if (existing.creationFingerprint !== creationFingerprint)
            throw new ConflictException(
              'Creation key was already used for a different service request',
            );
          if (existing.deletedAt || existing.status === 'archived')
            throw new ConflictException(
              'The created service was archived; it cannot be recreated with this key',
            );
          if (existing.version !== 0)
            throw new ConflictException({
              message:
                'The created service has changed; reload it before saving again',
              serviceId: existing.id,
            });
          return existing;
        }
      }
      await tx.creatorService.create({
        data: {
          id: serviceId,
          creatorId,
          creationKey,
          creationFingerprint,
          title: input.title,
          summary: input.summary,
          coverPath: input.coverPath,
          category: input.category,
          tags: input.tags,
        },
      });
      if (input.packages.length > 0) {
        await tx.servicePackage.createMany({
          data: input.packages.map((p) => packageToRow(serviceId, p)),
        });
      }
      if (input.requirementQuestions.length > 0) {
        // Create-path: no existing question ids belong to this
        // service yet (we just minted serviceId), so client-supplied
        // ids are always re-minted server-side. This blocks
        // id-spoofing across services on first save.
        await tx.serviceRequirementQuestion.createMany({
          data: materializeQuestions(
            serviceId,
            input.requirementQuestions,
            new Set(),
          ),
        });
      }
      const reloaded = await tx.creatorService.findUniqueOrThrow({
        where: { id: serviceId },
        include: { packages: true, requirementQuestions: true },
      });
      return reloaded;
    });
    return toServiceDTO(row, row.packages, row.requirementQuestions);
  }

  async update(id: string, actorId: string, input: UpdateServiceInput) {
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await this.requireOwned(id, actorId, tx);
      this.assertVersionMatches(existing, input.expectedVersion);
      if (input.packages !== undefined)
        this.assertPackagesValid(input.packages);
      await tx.creatorService.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.coverPath !== undefined
            ? { coverPath: input.coverPath }
            : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          version: { increment: 1 },
        },
      });

      if (input.packages !== undefined) {
        // Replace-all: drop old rows, insert new ones. Cheaper than
        // a per-row diff on a 1-3 element collection, and free of
        // order-dependent UNIQUE collisions because the DELETE flush
        // commits before the inserts.
        await tx.servicePackage.deleteMany({ where: { serviceId: id } });
        if (input.packages.length > 0) {
          await tx.servicePackage.createMany({
            data: input.packages.map((p) => packageToRow(id, p)),
          });
        }
      }

      if (input.requirementQuestions !== undefined) {
        // Replace-all on questionnaire. Order snapshots into
        // ServiceOrder.questionnaire are unaffected — those are
        // frozen at submit time on the order row, so an edit here
        // never rewrites order history.
        //
        // Lock the question id namespace to "ids that currently
        // belong to THIS service": preserve client-supplied ids that
        // match (preserves answer references), mint fresh for any
        // unknown id (blocks id-spoofing from other services).
        const existingIds = new Set(
          (
            await tx.serviceRequirementQuestion.findMany({
              where: { serviceId: id },
              select: { id: true },
            })
          ).map((r) => r.id),
        );
        await tx.serviceRequirementQuestion.deleteMany({
          where: { serviceId: id },
        });
        if (input.requirementQuestions.length > 0) {
          await tx.serviceRequirementQuestion.createMany({
            data: materializeQuestions(
              id,
              input.requirementQuestions,
              existingIds,
            ),
          });
        }
      }

      return tx.creatorService.findUniqueOrThrow({
        where: { id },
        include: { packages: true, requirementQuestions: true },
      });
    });
    return toServiceDTO(row, row.packages, row.requirementQuestions);
  }

  // ─── Transitions ─────────────────────────────────────────

  async publish(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.requireOwned(id, actorId, tx);
      if (existing.status === 'listed') return this.detail(id, actorId, tx);
      if (existing.status === 'archived') {
        throw new ConflictException('archived services cannot be republished');
      }
      const pkgCount = await tx.servicePackage.count({
        where: { serviceId: id },
      });
      if (pkgCount === 0) {
        throw new BadRequestException({
          message: 'Cannot publish a service with no packages',
          field: 'packages',
        });
      }
      await tx.creatorService.update({
        where: { id },
        data: {
          status: 'listed',
          publishedAt: existing.publishedAt ?? new Date(),
          version: { increment: 1 },
        },
      });
      return this.detail(id, actorId, tx);
    });
  }

  async pause(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.requireOwned(id, actorId, tx);
      if (existing.status === 'paused') return this.detail(id, actorId, tx);
      if (existing.status !== 'listed') {
        throw new ConflictException('only listed services can be paused');
      }
      await tx.creatorService.update({
        where: { id },
        data: { status: 'paused', version: { increment: 1 } },
      });
      return this.detail(id, actorId, tx);
    });
  }

  async resume(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.requireOwned(id, actorId, tx);
      if (existing.status === 'listed') return this.detail(id, actorId, tx);
      if (existing.status !== 'paused') {
        throw new ConflictException('only paused services can be resumed');
      }
      await tx.creatorService.update({
        where: { id },
        data: { status: 'listed', version: { increment: 1 } },
      });
      return this.detail(id, actorId, tx);
    });
  }

  /**
   * Soft-delete: status=archived AND deletedAt set. One-way. Phase
   * 1b orders that reference this service still resolve because we
   * never hard-delete.
   */
  async archive(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.requireOwned(id, actorId, tx);
      if (existing.status === 'archived') return this.detail(id, actorId, tx);
      await tx.creatorService.update({
        where: { id },
        data: {
          status: 'archived',
          deletedAt: new Date(),
          version: { increment: 1 },
        },
      });
      return this.detail(id, actorId, tx);
    });
  }

  // ─── Helpers ─────────────────────────────────────────────

  private async requireOwned(
    id: string,
    actorId: string,
    tx: Prisma.TransactionClient,
  ) {
    // Serialize every owner write before reading its version/state and children.
    // The row lock also orders these writes against other database writers.
    await tx.$queryRaw`SELECT id FROM creator_services WHERE id = ${id} AND creator_id = ${actorId} FOR UPDATE`;
    const row = await tx.creatorService.findUnique({ where: { id } });
    if (!row || row.deletedAt) {
      // 404 instead of 403 — don't leak that an archived service
      // exists at this id.
      throw new NotFoundException('Service not found');
    }
    if (row.creatorId !== actorId) {
      throw new ForbiddenException('Not the service owner');
    }
    return row;
  }

  private assertVersionMatches(
    existing: CreatorService,
    expected: number | undefined,
  ) {
    if (expected === undefined) return;
    if (existing.version !== expected) {
      throw new ConflictException({
        message:
          'Service was modified by someone else (or another tab). Reload and retry.',
        field: 'expectedVersion',
        actual: existing.version,
      });
    }
  }

  private assertPackagesValid(packages: PackageInput[]) {
    for (const p of packages) {
      assertAllowedCurrency(p.currency, 'packages.currency');
    }
  }
}

/**
 * Convert a wire PackageInput → DB row. Centralized here so the
 * currency × smallest-unit conversion uses a single source of truth.
 */
function packageToRow(serviceId: string, p: PackageInput) {
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(p.currency);
  const priceAmount = BigInt(
    Math.round(isZeroDecimal ? p.price : p.price * 100),
  );
  return {
    id: newShortId(),
    serviceId,
    tier: p.tier,
    title: p.title,
    description: p.description,
    currency: p.currency,
    priceAmount,
    deliveryDays: p.deliveryDays,
    revisions: p.revisions,
    scope: p.scope,
  };
}

/**
 * Convert wire QuestionInputs → DB rows for a single replace-all
 * write, while:
 *
 *   1. Rejecting duplicate ids inside the batch (BadRequest).
 *   2. Honoring client-supplied ids only when they're in
 *      `validExistingIds` (= the question ids that currently belong
 *      to this service). Unknown / cross-service ids are re-minted
 *      server-side. This blocks id-spoofing without breaking the
 *      "preserve id through edit" guarantee, which is what lets
 *      previously-answered questions keep stable references.
 */
function materializeQuestions(
  serviceId: string,
  inputs: QuestionInput[],
  validExistingIds: Set<string>,
) {
  const seen = new Set<string>();
  return inputs.map((q) => {
    let id: string;
    if (q.id && validExistingIds.has(q.id)) {
      id = q.id;
    } else {
      id = newShortId();
    }
    if (seen.has(id)) {
      throw new BadRequestException({
        message: 'requirementQuestions has duplicate id entries',
        field: 'requirementQuestions',
        id,
      });
    }
    seen.add(id);
    return {
      id,
      serviceId,
      prompt: q.prompt,
      helpText: q.helpText.length > 0 ? q.helpText : null,
      required: q.required,
      displayOrder: q.displayOrder,
    };
  });
}

/** Canonicalize the accepted create fields; object property insertion order is immaterial. */
function createServiceFingerprint(input: CreateServiceInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        title: input.title,
        summary: input.summary,
        coverPath: input.coverPath,
        category: input.category,
        tags: input.tags,
        packages: input.packages.map((p) => ({
          tier: p.tier,
          title: p.title,
          description: p.description,
          currency: p.currency,
          price: p.price,
          deliveryDays: p.deliveryDays,
          revisions: p.revisions,
          scope: p.scope,
        })),
        requirementQuestions: input.requirementQuestions.map((q) => ({
          id: q.id ?? null,
          prompt: q.prompt,
          helpText: q.helpText,
          required: q.required,
          displayOrder: q.displayOrder,
        })),
      }),
    )
    .digest('hex');
}
