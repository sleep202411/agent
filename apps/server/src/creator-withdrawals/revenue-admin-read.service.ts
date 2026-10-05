import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { encodeUserId } from '@repo/shared/user-id-codec';
import type { AdminActor } from '../admin-auth';
import { PrismaService } from '../infra/db/db.module';
import { LegacyCreatorsService } from '../legacy-creators/legacy-creators.service';
import { requireRevenueAdmin } from './revenue-admin-access';

export const RevenuePageQuery = z.strictObject({
  after: z.string().trim().min(1).max(128).optional(),
});
export const RevenueCrewQuery = RevenuePageQuery.extend({
  q: z.string().trim().max(100).default(''),
});
export const RevenueUuidPageQuery = z.strictObject({
  after: z.uuid().optional(),
});
export const RevenueHistoryQuery = RevenueUuidPageQuery.extend({
  q: z.string().trim().max(180).default(''),
  currency: z.enum(['USD', 'CNY']).optional(),
  recordedFrom: z.string().date().optional(),
  recordedThrough: z.string().date().optional(),
}).refine(
  (value) =>
    !value.recordedFrom ||
    !value.recordedThrough ||
    value.recordedFrom <= value.recordedThrough,
  {
    message: 'Recorded-through date must not precede recorded-from date.',
    path: ['recordedThrough'],
  },
);
const PAGE_SIZE = 50;
const ReceiptAllocations = z
  .array(
    z.object({
      crewMemberId: z.string(),
      userId: z.string(),
      shareBps: z.number().int().min(1).max(10000),
      amountMinor: z.string().regex(/^\d+$/),
    }),
  )
  .min(1)
  .max(1000);
function page<T extends { id: string }>(rows: T[]) {
  const items = rows.slice(0, PAGE_SIZE);
  return {
    items,
    nextCursor: rows.length > PAGE_SIZE ? items.at(-1)!.id : null,
  };
}

/** Read model for finance operators. Never returns storage capabilities,
 * bank details, or requires the unrelated Crew moderation permission. */
@Injectable()
export class RevenueAdminReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: LegacyCreatorsService,
  ) {}

  async crews(admin: AdminActor, raw: z.input<typeof RevenueCrewQuery>) {
    requireRevenueAdmin(admin);
    const { after, q } = RevenueCrewQuery.parse(raw);
    return page(
      await this.prisma.crew.findMany({
        where: {
          deletedAt: null,
          ...(after ? { id: { gt: after } } : {}),
          ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE + 1,
        select: { id: true, name: true },
      }),
    );
  }

  private async requireCrew(crewId: string) {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { id: true },
    });
    if (!crew) throw new NotFoundException('Crew not found.');
  }

  async members(
    admin: AdminActor,
    crewId: string,
    raw: z.input<typeof RevenuePageQuery>,
  ) {
    requireRevenueAdmin(admin);
    const { after } = RevenuePageQuery.parse(raw);
    await this.requireCrew(crewId);
    const result = page(
      await this.prisma.crewMember.findMany({
        // Departed members can retain contractual entitlements.
        where: { crewId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE + 1,
        select: { id: true, userId: true, status: true },
      }),
    );
    const identities = await this.directory.publicCreatorBatch([
      ...new Set(result.items.map((member) => member.userId)),
    ]);
    const names = new Map(
      identities.map((row) => [row.id, row.nick_name?.trim() || null]),
    );
    return {
      ...result,
      items: result.items.map((member) => ({
        id: member.id,
        publicId: encodeUserId(member.userId),
        name: names.get(member.userId) ?? null,
        status: member.status,
      })),
    };
  }

  async contracts(
    admin: AdminActor,
    crewId: string,
    raw: z.input<typeof RevenueUuidPageQuery>,
  ) {
    requireRevenueAdmin(admin);
    const { after } = RevenueUuidPageQuery.parse(raw);
    await this.requireCrew(crewId);
    const result = page(
      await this.prisma.crewRevenueContract.findMany({
        where: { crewId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE + 1,
        select: { id: true, filename: true, sizeBytes: true, verifiedAt: true },
      }),
    );
    return {
      ...result,
      items: result.items.map((row) => ({
        ...row,
        sizeBytes: row.sizeBytes.toString(),
        verifiedAt: row.verifiedAt.toISOString(),
      })),
    };
  }

  async distributions(
    admin: AdminActor,
    crewId: string,
    raw: z.input<typeof RevenueUuidPageQuery>,
  ) {
    requireRevenueAdmin(admin);
    const { after } = RevenueUuidPageQuery.parse(raw);
    await this.requireCrew(crewId);
    const result = page(
      await this.prisma.crewRevenueDistribution.findMany({
        where: {
          contract: { crewId },
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE + 1,
        select: {
          id: true,
          contractId: true,
          revenueReference: true,
          title: true,
          currency: true,
          amountMinor: true,
          postedByAdminId: true,
          postedAt: true,
        },
      }),
    );
    return {
      ...result,
      items: result.items.map((row) => ({
        ...row,
        amountMinor: row.amountMinor.toString(),
        postedAt: row.postedAt.toISOString(),
      })),
    };
  }

  /** Global immutable revenue history, including archived Crews. No storage capabilities. */
  async history(admin: AdminActor, raw: z.input<typeof RevenueHistoryQuery>) {
    requireRevenueAdmin(admin);
    const input = RevenueHistoryQuery.parse(raw);
    const where: Prisma.CrewRevenueDistributionWhereInput = {
      ...(input.after ? { id: { lt: input.after } } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.recordedFrom || input.recordedThrough
        ? {
            postedAt: {
              ...(input.recordedFrom
                ? { gte: new Date(`${input.recordedFrom}T00:00:00.000Z`) }
                : {}),
              ...(input.recordedThrough
                ? {
                    lt: new Date(
                      new Date(
                        `${input.recordedThrough}T00:00:00.000Z`,
                      ).getTime() + 86400000,
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...(input.q
        ? {
            OR: [
              { title: { contains: input.q, mode: 'insensitive' } },
              { revenueReference: { contains: input.q, mode: 'insensitive' } },
              {
                contract: {
                  filename: { contains: input.q, mode: 'insensitive' },
                },
              },
              {
                contract: {
                  crew: { name: { contains: input.q, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };
    const result = page(
      await this.prisma.crewRevenueDistribution.findMany({
        where,
        orderBy: { id: 'desc' },
        take: PAGE_SIZE + 1,
        select: {
          id: true,
          title: true,
          revenueReference: true,
          currency: true,
          amountMinor: true,
          postedAt: true,
          postedByAdminId: true,
          contract: {
            select: {
              id: true,
              filename: true,
              crew: { select: { id: true, name: true, deletedAt: true } },
            },
          },
          earnings: { select: { status: true } },
        },
      }),
    );
    return {
      ...result,
      items: result.items.map(({ contract, earnings, ...row }) => ({
        ...row,
        amountMinor: row.amountMinor.toString(),
        postedAt: row.postedAt.toISOString(),
        contract: { id: contract.id, filename: contract.filename },
        crew: {
          id: contract.crew.id,
          name: contract.crew.name,
          archived: contract.crew.deletedAt !== null,
        },
        status:
          earnings.length === 0
            ? 'missing_earnings'
            : earnings.every((entry) => entry.status === 'reversed')
              ? 'reversed'
              : earnings.some((entry) => entry.status === 'reversed')
                ? 'partially_reversed'
                : 'posted',
      })),
    };
  }

  async distribution(admin: AdminActor, id: string) {
    requireRevenueAdmin(admin);
    z.uuid().parse(id);
    const row = await this.prisma.crewRevenueDistribution.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        revenueReference: true,
        amountMinor: true,
        currency: true,
        postedByAdminId: true,
        postedAt: true,
        allocations: true,
        incomeDate: true,
        incomeType: true,
        incomeSource: true,
        notes: true,
        contractNumber: true,
        signingParty: true,
        contractExpiresOn: true,
        supportingContracts: {
          select: { contract: { select: { id: true, filename: true } } },
        },
        contract: {
          select: {
            id: true,
            filename: true,
            crew: { select: { id: true, name: true } },
          },
        },
        earnings: {
          select: {
            id: true,
            crewMemberId: true,
            status: true,
            reversalReason: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Revenue receipt not found.');
    // Historical evidence remains readable even if the Crew is subsequently
    // archived or its members leave. Public IDs are derived from the immutable
    // receipt identity, not from a live directory lookup that can be unavailable.
    const earnings = new Map(
      row.earnings.map((earning) => [earning.crewMemberId, earning]),
    );
    return {
      id: row.id,
      title: row.title,
      revenueReference: row.revenueReference,
      currency: row.currency,
      amountMinor: row.amountMinor.toString(),
      postedByAdminId: row.postedByAdminId,
      postedAt: row.postedAt.toISOString(),
      incomeDate: row.incomeDate?.toISOString().slice(0, 10) ?? null,
      incomeType: row.incomeType,
      incomeSource: row.incomeSource,
      notes: row.notes,
      contractNumber: row.contractNumber,
      signingParty: row.signingParty,
      contractExpiresOn:
        row.contractExpiresOn?.toISOString().slice(0, 10) ?? null,
      supportingContracts: row.supportingContracts.map((item) => item.contract),
      crew: row.contract.crew,
      contract: { id: row.contract.id, filename: row.contract.filename },
      participants: ReceiptAllocations.parse(row.allocations).map(
        (participant) => {
          const earning = earnings.get(participant.crewMemberId);
          return {
            crewMemberId: participant.crewMemberId,
            publicId: encodeUserId(participant.userId),
            shareBps: participant.shareBps,
            amountMinor: participant.amountMinor,
            earningId: earning?.id ?? null,
            status:
              earning?.status ??
              (participant.amountMinor === '0'
                ? 'zero_amount'
                : 'missing_earning'),
            reversalReason: earning?.reversalReason ?? null,
          };
        },
      ),
    };
  }
}
