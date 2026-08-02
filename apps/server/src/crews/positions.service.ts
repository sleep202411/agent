/**
 * Position CRUD inside a crew.
 *
 * Status invariant:
 *   open    — public, accepting applications
 *   frozen  — owner toggled off; not visible to outsiders
 *   full    — recruitedCount >= targetCount; service-managed.
 *             Owner can't manually set FULL — applications go through
 *             approve workflow, and a remove drops back to open.
 *
 * Hard-soft delete (deletedAt) is ALWAYS blocked while pending
 * applications exist — per spec, owner must process them first.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { assertAllowedCurrency, toSmallestUnit } from '../common/currency';
import type {
  CreatePositionInput,
  ListCrewPositionsQuery,
  ListPublicPositionsQuery,
  UpdatePositionInput,
} from './dto';
import { newCrewDomainId } from './id';
import { toPositionDTO } from './mappers';
import { CrewAuthorizationService } from './crew-authorization.service';

@Injectable()
export class PositionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
  ) {}

  async list(
    crewId: string,
    viewerId: string | null,
    query: ListCrewPositionsQuery,
  ) {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { listingStatus: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');

    const viewer = viewerId
      ? await this.authorization.resolve(crewId, viewerId)
      : null;
    if (crew.listingStatus !== 'listed' && !viewer) {
      // Mirror crews.detail visibility — unlisted crews are accessible
      // only to founder + active members. Deep-linking to
      // /crews/:id/positions must not leak position lists either.
      throw new NotFoundException('Crew not found');
    }

    const canManage = viewer?.permissions.includes('openings.manage') ?? false;
    const where = {
      crewId,
      deletedAt: null,
      ...(canManage ? {} : { status: { not: 'frozen' as const } }),
    } satisfies Prisma.CrewPositionWhereInput;
    if (query.cursor) {
      const cursor = await this.prisma.crewPosition.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) {
        throw new BadRequestException({
          message:
            'The crew positions cursor is invalid for the current viewer. Restart from the first page.',
        });
      }
    }
    const [rows, total] = await Promise.all([
      this.prisma.crewPosition.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.prisma.crewPosition.count({ where }),
    ]);
    const page = rows.slice(0, query.limit);
    const applicationGroups = canManage
      ? await this.prisma.crewApplication.groupBy({
          by: ['positionId', 'status'],
          where: { crewId, positionId: { in: page.map((row) => row.id) } },
          _count: { _all: true },
        })
      : [];
    const counts = new Map<
      string,
      { total: number; pending: number; approved: number; rejected: number }
    >();
    for (const group of applicationGroups) {
      const current = counts.get(group.positionId) ?? {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
      };
      const count = group._count._all;
      current[group.status] += count;
      current.total += count;
      counts.set(group.positionId, current);
    }
    return {
      items: page.map((row) =>
        toPositionDTO(
          row,
          canManage
            ? (counts.get(row.id) ?? {
                total: 0,
                pending: 0,
                approved: 0,
                rejected: 0,
              })
            : undefined,
        ),
      ),
      nextCursor:
        rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
      total,
    };
  }

  async listPublic(query: ListPublicPositionsQuery) {
    const limit = query.limit;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const where = {
      deletedAt: null,
      status: 'open',
      OR: [{ closeDate: null }, { closeDate: { gte: today } }],
      ...(query.employment.length
        ? { employmentType: { in: query.employment } }
        : {}),
      ...(query.seniority.length
        ? { experienceLevel: { in: query.seniority } }
        : {}),
      ...(query.workMode.length ? { workMode: { in: query.workMode } } : {}),
      // Mirror crews.list visibility: positions on unlisted crews
      // must not surface in the public plaza, otherwise a clicker
      // lands on a 404 crew-detail page (crews.detail rejects
      // non-member viewers for unlisted crews).
      crew: { deletedAt: null, listingStatus: 'listed' },
    } satisfies Prisma.CrewPositionWhereInput;
    const direction = query.sort === 'oldest' ? 'asc' : 'desc';
    if (query.cursor) {
      const cursor = await this.prisma.crewPosition.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) {
        throw new BadRequestException({
          message:
            'The positions cursor is invalid for the current filters. Restart from the first page.',
        });
      }
    }
    const [rows, total] = await Promise.all([
      this.prisma.crewPosition.findMany({
        where,
        include: {
          crew: {
            select: {
              id: true,
              name: true,
              logo: true,
              tagline: true,
              genres: true,
              styles: true,
            },
          },
        },
        orderBy: [{ createdAt: direction }, { id: direction }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.prisma.crewPosition.count({ where }),
    ]);

    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({
        position: toPositionDTO(row),
        crew: {
          id: row.crew.id,
          name: row.crew.name,
          logo: row.crew.logo,
          tagline: row.crew.tagline,
          genres: row.crew.genres,
          styles: row.crew.styles,
        },
      })),
      nextCursor:
        rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      total,
    };
  }

  async create(crewId: string, ownerId: string, input: CreatePositionInput) {
    await this.authorization.require(crewId, ownerId, 'openings.manage');
    assertAllowedCurrency(input.salary?.currency, 'salary.currency');
    const ccy = input.salary?.currency ?? null;
    const row = await this.prisma.crewPosition.create({
      data: {
        id: newCrewDomainId(),
        crewId,
        positionType: input.positionType,
        description: input.description,
        targetCount: input.targetCount,
        workMode: input.workMode,
        location: input.workMode === 'remote' ? null : (input.location ?? null),
        employmentType: input.employmentType,
        experienceLevel: input.experienceLevel,
        requiredSkills: input.requiredSkills,
        salaryPeriod: input.salary?.period ?? null,
        salaryCurrency: ccy,
        salaryMinAmount:
          input.salary?.min != null && ccy != null
            ? toSmallestUnit(input.salary.min, ccy)
            : null,
        salaryMaxAmount:
          input.salary?.max != null && ccy != null
            ? toSmallestUnit(input.salary.max, ccy)
            : null,
        salaryNegotiable: input.salary?.negotiable ?? false,
        durationMonths: input.durationMonths ?? null,
        // Wire is plain %, storage is bp. Math.round guards against
        // FP rounding from values like 2.5 (which round-trips fine
        // but defensive-coded for future steps like 0.25 if we relax).
        revenueShareBp:
          input.revenueSharePercent != null
            ? Math.round(input.revenueSharePercent * 100)
            : null,
        closeDate: input.closeDate
          ? new Date(`${input.closeDate}T00:00:00Z`)
          : null,
      },
    });
    return toPositionDTO(row);
  }

  async update(
    crewId: string,
    positionId: string,
    ownerId: string,
    input: UpdatePositionInput,
  ) {
    await this.authorization.require(crewId, ownerId, 'openings.manage');
    const pos = await this.requirePosition(crewId, positionId);
    assertAllowedCurrency(input.salary?.currency, 'salary.currency');

    if (
      input.targetCount !== undefined &&
      input.targetCount < pos.recruitedCount
    ) {
      throw new BadRequestException({
        message: 'targetCount cannot be below recruitedCount',
        field: 'targetCount',
        recruitedCount: pos.recruitedCount,
      });
    }

    let nextStatus = input.status ?? pos.status;
    if (input.targetCount !== undefined) {
      const tc = input.targetCount;
      if (pos.recruitedCount >= tc) nextStatus = 'full';
      else if (pos.status === 'full' && pos.recruitedCount < tc)
        nextStatus = 'open';
    }

    const updated = await this.prisma.crewPosition.update({
      where: { id: positionId },
      data: {
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.targetCount !== undefined
          ? { targetCount: input.targetCount }
          : {}),
        ...(input.workMode !== undefined ? { workMode: input.workMode } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.employmentType !== undefined
          ? { employmentType: input.employmentType }
          : {}),
        ...(input.experienceLevel !== undefined
          ? { experienceLevel: input.experienceLevel }
          : {}),
        ...(input.requiredSkills !== undefined
          ? { requiredSkills: input.requiredSkills }
          : {}),
        ...(input.salary?.period !== undefined
          ? { salaryPeriod: input.salary.period }
          : {}),
        ...(input.salary?.currency !== undefined
          ? { salaryCurrency: input.salary.currency }
          : {}),
        ...(input.salary?.min !== undefined && input.salary?.currency
          ? {
              salaryMinAmount:
                input.salary.min != null
                  ? toSmallestUnit(input.salary.min, input.salary.currency)
                  : null,
            }
          : {}),
        ...(input.salary?.max !== undefined && input.salary?.currency
          ? {
              salaryMaxAmount:
                input.salary.max != null
                  ? toSmallestUnit(input.salary.max, input.salary.currency)
                  : null,
            }
          : {}),
        ...(input.salary?.negotiable !== undefined
          ? { salaryNegotiable: input.salary.negotiable }
          : {}),
        ...(input.durationMonths !== undefined
          ? { durationMonths: input.durationMonths }
          : {}),
        ...(input.revenueSharePercent !== undefined
          ? {
              revenueShareBp:
                input.revenueSharePercent != null
                  ? Math.round(input.revenueSharePercent * 100)
                  : null,
            }
          : {}),
        ...(input.closeDate !== undefined
          ? {
              closeDate: input.closeDate
                ? new Date(`${input.closeDate}T00:00:00Z`)
                : null,
            }
          : {}),
        status: nextStatus,
      },
    });
    return toPositionDTO(updated);
  }

  async delete(
    crewId: string,
    positionId: string,
    ownerId: string,
  ): Promise<void> {
    await this.authorization.require(crewId, ownerId, 'openings.manage');
    await this.requirePosition(crewId, positionId);

    const pendingCount = await this.prisma.crewApplication.count({
      where: { positionId, status: 'pending' },
    });
    if (pendingCount > 0) {
      throw new ConflictException({
        message: 'Cannot delete position with pending applications',
        pendingCount,
      });
    }
    await this.prisma.crewPosition.update({
      where: { id: positionId },
      data: { deletedAt: new Date() },
    });
  }

  private async requirePosition(crewId: string, positionId: string) {
    const pos = await this.prisma.crewPosition.findFirst({
      where: { id: positionId, crewId, deletedAt: null },
    });
    if (!pos) throw new NotFoundException('Position not found');
    return pos;
  }
}
