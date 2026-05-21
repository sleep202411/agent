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
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../infra/db/db.module';
import {
  assertAllowedCurrency,
  toSmallestUnit,
  type CurrencyCode,
} from './currency';
import type { CreatePositionInput, UpdatePositionInput } from './dto';
import { newCrewDomainId } from './id';
import { toPositionDTO } from './mappers';

@Injectable()
export class PositionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(crewId: string, viewerId: string | null = null) {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { founderId: true, listingStatus: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');

    const isFounder = viewerId !== null && viewerId === crew.founderId;
    if (crew.listingStatus !== 'listed' && !isFounder) {
      // Mirror crews.detail visibility — unlisted crews are accessible
      // only to founder + active members. Deep-linking to
      // /crews/:id/positions must not leak position lists either.
      const isMember =
        viewerId !== null &&
        (await this.prisma.crewMember.count({
          where: { crewId, userId: viewerId, removedAt: null },
        })) > 0;
      if (!isMember) throw new NotFoundException('Crew not found');
    }

    const canManage = isFounder;
    const rows = await this.prisma.crewPosition.findMany({
      where: {
        crewId,
        deletedAt: null,
        ...(canManage ? {} : { status: { not: 'frozen' as const } }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPositionDTO);
  }

  async listPublic(opts: { limit?: number; cursor?: string }) {
    const limit = clampLimit(opts.limit);
    const today = new Date(new Date().toISOString().slice(0, 10));
    const rows = await this.prisma.crewPosition.findMany({
      where: {
        deletedAt: null,
        status: 'open',
        OR: [{ closeDate: null }, { closeDate: { gte: today } }],
        // Mirror crews.list visibility: positions on unlisted crews
        // must not surface in the public plaza, otherwise a clicker
        // lands on a 404 crew-detail page (crews.detail rejects
        // non-member viewers for unlisted crews).
        crew: { deletedAt: null, listingStatus: 'listed' },
      },
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

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
    };
  }

  async create(crewId: string, ownerId: string, input: CreatePositionInput) {
    await this.assertOwner(crewId, ownerId);
    assertAllowedCurrency(input.salary?.currency, 'salary.currency');
    const ccy = (input.salary?.currency ?? null) as CurrencyCode | null;
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
    await this.assertOwner(crewId, ownerId);
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
    await this.assertOwner(crewId, ownerId);
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

  private async assertOwner(crewId: string, userId: string) {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { founderId: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');
    if (crew.founderId !== userId) {
      throw new ForbiddenException({
        message: 'Only the crew owner can do this',
      });
    }
  }

  private async requirePosition(crewId: string, positionId: string) {
    const pos = await this.prisma.crewPosition.findFirst({
      where: { id: positionId, crewId, deletedAt: null },
    });
    if (!pos) throw new NotFoundException('Position not found');
    return pos;
  }
}

function clampLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 48;
  return Math.min(60, Math.max(1, Math.trunc(raw)));
}
