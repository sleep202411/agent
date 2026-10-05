import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AdminActor } from '../admin-auth';
import { PrismaService } from '../infra/db/db.module';
import { lockLedgerReceipt } from '../crews/earnings/ledger-lock';
import { assertNewCrewCurrency } from '../crews/earnings/ledger-currency';
import { requireRevenueAdmin } from './revenue-admin-access';

// Drafts accept incomplete form values, never ledger entries or storage capabilities.
export const RevenueDraftData = z.strictObject({
  currency: z.enum(['USD', 'CNY']),
  contract: z.union([z.uuid(), z.literal('')]),
  additionalContracts: z.array(z.uuid()).max(19),
  incomeDate: z.string().max(10),
  incomeType: z.enum([
    '',
    'licensing',
    'advertising',
    'merchandise',
    'course_sales',
    'other',
  ]),
  incomeSource: z.string().max(180),
  notes: z.string().max(200),
  contractNumber: z.string().max(180),
  signingParty: z.string().max(180),
  contractExpiresOn: z.string().max(10),
  amount: z.string().max(40),
  reference: z.string().max(180),
  title: z.string().max(180),
  shares: z
    .record(z.string().min(1).max(128), z.string().max(20))
    .refine((v) => Object.keys(v).length <= 1000),
});
export const SaveRevenueDraft = z.strictObject({
  revision: z.number().int().min(0).max(2147483646),
  data: RevenueDraftData.nullable(),
});
@Injectable()
export class RevenueDraftsService {
  constructor(private readonly prisma: PrismaService) {}
  async get(admin: AdminActor, crewId: string) {
    requireRevenueAdmin(admin);
    const row = await this.prisma.crewRevenueDraft.findUnique({
      where: { adminId_crewId: { adminId: admin.id, crewId } },
    });
    const parsed = row?.data ? RevenueDraftData.parse(row.data) : null;
    const ids = parsed
      ? [
          ...new Set(
            [parsed.contract, ...parsed.additionalContracts].filter(Boolean),
          ),
        ]
      : [];
    const contracts = ids.length
      ? await this.prisma.crewRevenueContract.findMany({
          where: { id: { in: ids }, crewId },
          select: { id: true, filename: true, verifiedAt: true },
        })
      : [];
    return {
      revision: row?.revision ?? 0,
      data: parsed,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      contracts: contracts.map((file) => ({
        ...file,
        verifiedAt: file.verifiedAt.toISOString(),
      })),
    };
  }
  async save(
    admin: AdminActor,
    crewId: string,
    raw: z.input<typeof SaveRevenueDraft>,
  ) {
    requireRevenueAdmin(admin);
    const input = SaveRevenueDraft.parse(raw);
    if (input.data) assertNewCrewCurrency(input.data.currency);
    return this.prisma.$transaction(async (tx) => {
      await lockLedgerReceipt(tx, `revenue-draft:${admin.id}:${crewId}`);
      const crew = await tx.crew.findFirst({
        where: { id: crewId, deletedAt: null },
        select: { id: true },
      });
      if (!crew) throw new NotFoundException('Crew not found.');
      const where = { adminId_crewId: { adminId: admin.id, crewId } };
      const previous = await tx.crewRevenueDraft.findUnique({ where });
      if ((previous?.revision ?? 0) !== input.revision)
        throw new ConflictException(
          'This draft changed in another session. Load the saved draft before saving again.',
        );
      const ids = [
        ...new Set(
          [
            input.data?.contract,
            ...(input.data?.additionalContracts ?? []),
          ].filter((id): id is string => Boolean(id)),
        ),
      ];
      if (
        ids.length &&
        (await tx.crewRevenueContract.count({
          where: { id: { in: ids }, crewId },
        })) !== ids.length
      )
        throw new ConflictException(
          'A draft contract does not belong to this Crew.',
        );
      const data = {
        data: input.data ?? Prisma.DbNull,
        revision: input.revision + 1,
      };
      const row = await tx.crewRevenueDraft.upsert({
        where,
        create: { adminId: admin.id, crewId, ...data },
        update: data,
      });
      return {
        revision: row.revision,
        data: row.data,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }
}
