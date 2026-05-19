/**
 * Crew CRUD — create / list / detail / update / soft delete.
 *
 * Update path uses **optimistic concurrency control** via the
 * `version` column. Callers either:
 *   - supply `expectedVersion` they got from a prior read (recommended
 *     for any owner-facing edit flow) → 409 on mismatch, or
 *   - omit it → straight overwrite (only for system / migration paths).
 *
 * Aggregates (memberCount, openPositionCount, pendingApplicationCount)
 * are joined here so list / detail responses are render-complete in
 * one round trip.
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import type {
  CreateCrewInput,
  UpdateCrewInput,
  UpdateCrewListingInput,
} from './dto';
import { newCrewDomainId, newCrewId } from './id';
import { toCrewDTO } from './mappers';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class CrewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(founderId: string, input: CreateCrewInput) {
    const crew = await this.prisma.$transaction(async (tx) => {
      const c = await tx.crew.create({
        data: {
          id: newCrewId(),
          name: input.name,
          description: input.description,
          logo: input.logo,
          tagline: input.tagline ?? null,
          genres: input.genres,
          styles: input.styles,
          // Empty arrays come through as SQL NULL — Prisma's JsonB
          // column requires Prisma.DbNull for the null literal.
          ...(input.socialLinks.length > 0
            ? { socialLinks: input.socialLinks }
            : { socialLinks: Prisma.DbNull }),
          ...(input.showcaseWorks.length > 0
            ? { showcaseWorks: input.showcaseWorks }
            : { showcaseWorks: Prisma.DbNull }),
          founderId,
        },
      });
      // Founder is the first crew member with role "owner". Keeps
      // `crew_members` the single source of truth for "who's in this
      // crew" — no special-casing the founder elsewhere.
      await tx.crewMember.create({
        data: {
          id: newCrewDomainId(),
          crewId: c.id,
          userId: founderId,
          roleType: 'owner',
          via: 'founder',
        },
      });
      return c;
    });
    return toCrewDTO(crew, {
      memberCount: 1,
      openPositionCount: 0,
      pendingApplicationCount: 0,
    });
  }

  async list(opts: { limit?: number; cursor?: string } = {}) {
    const limit = clampPageSize(opts.limit);
    const rows = await this.prisma.crew.findMany({
      where: { deletedAt: null, listingStatus: 'listed' },
      orderBy: [{ listedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const counts = await this.countsFor(slice.map((c) => c.id));
    return {
      items: slice.map((c) =>
        toCrewDTO(c, {
          memberCount: counts.members.get(c.id) ?? 0,
          openPositionCount: counts.openPositions.get(c.id) ?? 0,
          openPositionPreview: counts.openPositionPreview.get(c.id) ?? [],
        }),
      ),
      nextCursor: hasMore ? slice[slice.length - 1].id : null,
    };
  }

  async detail(id: string, viewerId: string | null) {
    const crew = await this.prisma.crew.findFirst({
      where: { id, deletedAt: null },
    });
    if (!crew) throw new NotFoundException('Crew not found');
    if (crew.listingStatus !== 'listed') {
      const canView =
        viewerId !== null &&
        (crew.founderId === viewerId ||
          (await this.isActiveCrewMember(id, viewerId)));
      if (!canView) throw new NotFoundException('Crew not found');
    }

    const counts = await this.countsFor([id]);
    const isOwner = viewerId !== null && crew.founderId === viewerId;
    // Pending-application count is owner-only info (exposing it to
    // visitors leaks recruiting velocity).
    const pendingApplicationCount = isOwner
      ? await this.prisma.crewApplication.count({
          where: { crewId: id, status: 'pending' },
        })
      : undefined;
    return toCrewDTO(crew, {
      memberCount: counts.members.get(id) ?? 0,
      openPositionCount: counts.openPositions.get(id) ?? 0,
      openPositionPreview: counts.openPositionPreview.get(id) ?? [],
      pendingApplicationCount,
    });
  }

  /**
   * Update with optimistic concurrency.
   *
   * `expectedVersion`:
   *   - supplied: write only if the row's current version matches
   *     (Prisma `updateMany` returns count=0 if not). Throws 409.
   *   - omitted: overwrite without check (admin / migration path).
   *
   * On success `version` increments by 1.
   */
  async update(
    id: string,
    ownerId: string,
    input: UpdateCrewInput & { expectedVersion?: number },
  ) {
    await this.assertOwner(id, ownerId);

    const patch: Prisma.CrewUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.logo !== undefined ? { logo: input.logo } : {}),
      ...(input.tagline !== undefined ? { tagline: input.tagline } : {}),
      ...(input.genres !== undefined ? { genres: input.genres } : {}),
      ...(input.styles !== undefined ? { styles: input.styles } : {}),
      ...(input.socialLinks !== undefined
        ? {
            socialLinks:
              input.socialLinks.length > 0 ? input.socialLinks : Prisma.DbNull,
          }
        : {}),
      ...(input.showcaseWorks !== undefined
        ? {
            showcaseWorks:
              input.showcaseWorks.length > 0
                ? input.showcaseWorks
                : Prisma.DbNull,
          }
        : {}),
      version: { increment: 1 },
    };

    if (input.expectedVersion !== undefined) {
      const r = await this.prisma.crew.updateMany({
        where: { id, version: input.expectedVersion, deletedAt: null },
        data: patch,
      });
      if (r.count === 0) {
        // Distinguish "row gone" from "version stale".
        const current = await this.prisma.crew.findUnique({
          where: { id },
          select: { version: true, deletedAt: true },
        });
        if (!current || current.deletedAt)
          throw new NotFoundException('Crew not found');
        throw new ConflictException({
          message: 'Crew was modified by someone else; refresh and retry',
          expectedVersion: input.expectedVersion,
          actualVersion: current.version,
        });
      }
    } else {
      await this.prisma.crew.update({ where: { id }, data: patch });
    }

    const updated = await this.prisma.crew.findUnique({ where: { id } });
    if (!updated) throw new NotFoundException('Crew not found');
    return toCrewDTO(updated);
  }

  async updateListing(
    id: string,
    ownerId: string,
    input: UpdateCrewListingInput,
  ) {
    await this.assertOwner(id, ownerId);

    const data: Prisma.CrewUpdateInput = {
      listingStatus: input.listingStatus,
      listedAt: input.listingStatus === 'listed' ? new Date() : null,
      version: { increment: 1 },
    };

    if (input.expectedVersion !== undefined) {
      const r = await this.prisma.crew.updateMany({
        where: { id, version: input.expectedVersion, deletedAt: null },
        data,
      });
      if (r.count === 0) {
        const current = await this.prisma.crew.findUnique({
          where: { id },
          select: { version: true, deletedAt: true },
        });
        if (!current || current.deletedAt)
          throw new NotFoundException('Crew not found');
        throw new ConflictException({
          message: 'Crew was modified by someone else; refresh and retry',
          expectedVersion: input.expectedVersion,
          actualVersion: current.version,
        });
      }
    } else {
      await this.prisma.crew.update({ where: { id }, data });
    }

    const updated = await this.prisma.crew.findUnique({ where: { id } });
    if (!updated) throw new NotFoundException('Crew not found');
    return toCrewDTO(updated);
  }

  async softDelete(id: string, ownerId: string): Promise<void> {
    await this.assertOwner(id, ownerId);
    await this.prisma.crew.update({
      where: { id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
  }

  /** Founded + joined crews for the current user — drives /profile?tab=crews. */
  async myCrews(userId: string) {
    const memberships = await this.prisma.crewMember.findMany({
      where: { userId, removedAt: null, crew: { deletedAt: null } },
      orderBy: { joinedAt: 'desc' },
      include: { crew: true },
    });
    const crews = memberships.map((m) => m.crew);
    const counts = await this.countsFor(crews.map((c) => c.id));
    const pending = await this.prisma.crewApplication.groupBy({
      by: ['crewId'],
      where: { status: 'pending', crewId: { in: crews.map((c) => c.id) } },
      _count: { _all: true },
    });
    const pendingByCrew = new Map<string, number>();
    for (const p of pending) pendingByCrew.set(p.crewId, p._count._all);

    const founded: ReturnType<typeof toCrewDTO>[] = [];
    const joined: ReturnType<typeof toCrewDTO>[] = [];
    for (const m of memberships) {
      const dto = toCrewDTO(m.crew, {
        memberCount: counts.members.get(m.crew.id) ?? 0,
        openPositionCount: counts.openPositions.get(m.crew.id) ?? 0,
        openPositionPreview: counts.openPositionPreview.get(m.crew.id) ?? [],
        ...(m.via === 'founder'
          ? { pendingApplicationCount: pendingByCrew.get(m.crew.id) ?? 0 }
          : {}),
      });
      if (m.via === 'founder') founded.push(dto);
      else joined.push(dto);
    }
    return { founded, joined };
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

  private async isActiveCrewMember(
    crewId: string,
    viewerId: string,
  ): Promise<boolean> {
    const membership = await this.prisma.crewMember.findFirst({
      where: { crewId, userId: viewerId, removedAt: null },
      select: { id: true },
    });
    return membership !== null;
  }

  /** Aggregate members + open positions for a batch of crew ids. */
  private async countsFor(ids: string[]) {
    if (ids.length === 0) {
      return {
        members: new Map<string, number>(),
        openPositions: new Map<string, number>(),
        openPositionPreview: new Map<string, string[]>(),
      };
    }
    const [memberRows, positionRows, recentOpenRows] = await Promise.all([
      this.prisma.crewMember.groupBy({
        by: ['crewId'],
        where: { crewId: { in: ids }, removedAt: null },
        _count: { _all: true },
      }),
      this.prisma.crewPosition.groupBy({
        by: ['crewId'],
        where: { crewId: { in: ids }, status: 'open', deletedAt: null },
        _count: { _all: true },
      }),
      // Preview names for the plaza card — newest 3 open positions
      // per crew, ordered by createdAt desc. Cheap to fetch
      // alongside the counts: server-paginates to ≤3 × N rows.
      this.prisma.crewPosition.findMany({
        where: { crewId: { in: ids }, status: 'open', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { crewId: true, positionType: true, createdAt: true },
      }),
    ]);
    const members = new Map<string, number>();
    for (const r of memberRows) members.set(r.crewId, r._count._all);
    const openPositions = new Map<string, number>();
    for (const r of positionRows) openPositions.set(r.crewId, r._count._all);
    const openPositionPreview = new Map<string, string[]>();
    for (const r of recentOpenRows) {
      const cur = openPositionPreview.get(r.crewId);
      if (cur && cur.length >= 3) continue;
      openPositionPreview.set(
        r.crewId,
        cur ? [...cur, r.positionType] : [r.positionType],
      );
    }
    return { members, openPositions, openPositionPreview };
  }
}

function clampPageSize(n?: number): number {
  if (!n || n <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}
