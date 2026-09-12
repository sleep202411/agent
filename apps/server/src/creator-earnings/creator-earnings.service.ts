import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../infra/db/db.module';

export const EarningsQuerySchema = z.object({
  locale: z.enum(['en-US', 'zh-CN', 'zh-HK']).default('en-US'),
  work: z
    .string()
    .regex(/^(story|ip):[0-9a-f-]{36}$/i)
    .optional(),
  days: z.enum(['all', '30', '90']).default('all'),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type EarningsQuery = z.infer<typeof EarningsQuerySchema>;
const reasons = ['ip_revenue_share', 'story_content_revenue'];
function metadata(value: Prisma.JsonValue): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}
function string(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class CreatorEarningsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: EarningsQuery) {
    const account = await this.prisma.walletAccount.findUnique({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: 'user',
          ownerId: userId,
          currency: 'community_point',
          balanceKind: 'withdrawable',
        },
      },
      select: { id: true, availableBalance: true },
    });
    if (!account)
      return {
        lifetimeEarned: '0',
        withdrawableBalance: '0',
        works: [],
        entries: [],
        nextCursor: null,
      };
    // Every query starts with the authenticated beneficiary's account. Never accept a user ID from the client.
    const base: Prisma.WalletLedgerEntryWhereInput = {
      accountId: account.id,
      entryType: 'credit',
      reason: { in: reasons },
      transaction: { status: 'posted' },
    };
    const filters: Prisma.WalletLedgerEntryWhereInput[] = [base];
    if (query.days !== 'all')
      filters.push({
        createdAt: {
          gte: new Date(Date.now() - Number(query.days) * 86400000),
        },
      });
    if (query.work) {
      const [kind, id] = query.work.split(':');
      filters.push({
        reason: kind === 'story' ? 'story_content_revenue' : 'ip_revenue_share',
        transaction: {
          metadata: {
            path: [kind === 'story' ? 'projectId' : 'ipId'],
            equals: id,
          },
        },
      });
    }
    if (query.cursor) {
      const cursor = await this.prisma.walletLedgerEntry.findFirst({
        where: { AND: [...filters, { id: query.cursor }] },
        select: { createdAt: true, id: true },
      });
      if (!cursor) throw new BadRequestException('Invalid earnings cursor');
      filters.push({
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      });
    }
    const [totals, rows, workKeys] = await Promise.all([
      this.prisma.walletLedgerEntry.aggregate({
        where: base,
        _sum: { amount: true },
      }),
      this.prisma.walletLedgerEntry.findMany({
        where: { AND: filters },
        include: { transaction: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      this.prisma.$queryRaw<Array<{ kind: string; id: string }>>(Prisma.sql`
        SELECT DISTINCT CASE WHEN e.reason = 'story_content_revenue' THEN 'story' ELSE 'ip' END AS kind,
          CASE WHEN e.reason = 'story_content_revenue' THEN t.metadata->>'projectId' ELSE t.metadata->>'ipId' END AS id
        FROM wallet_ledger_entries e JOIN wallet_transactions t ON t.id = e.transaction_id
        WHERE e.account_id = ${account.id}::uuid AND e.entry_type = 'credit' AND t.status = 'posted'
          AND e.reason IN ('story_content_revenue', 'ip_revenue_share')
      `),
    ]);
    const validWorks = workKeys.filter(
      (work) => z.uuid().safeParse(work.id).success,
    );
    const [stories, ips] = await Promise.all([
      this.prisma.storyProject.findMany({
        where: {
          id: {
            in: validWorks.filter((w) => w.kind === 'story').map((w) => w.id),
          },
        },
        select: { id: true, title: true },
      }),
      this.prisma.ip.findMany({
        where: {
          id: {
            in: validWorks.filter((w) => w.kind === 'ip').map((w) => w.id),
          },
        },
        select: {
          id: true,
          localizations: {
            where: { archivedAt: null },
            select: { locale: true, title: true },
            orderBy: { locale: 'asc' },
          },
        },
      }),
    ]);
    const titles = new Map<string, string>();
    stories.forEach((s) => titles.set(`story:${s.id}`, s.title));
    ips.forEach((ip) =>
      titles.set(
        `ip:${ip.id}`,
        (
          ip.localizations.find((l) => l.locale === query.locale) ??
          ip.localizations.find((l) => l.locale === 'en-US') ??
          ip.localizations[0]
        )?.title ?? '',
      ),
    );
    const items = rows.slice(0, query.limit);
    const purchaseIds = items
      .filter((r) => r.reason === 'story_content_revenue')
      .map((r) => r.transaction.sourceId)
      .filter((id): id is string => !!id && z.uuid().safeParse(id).success);
    const [purchases, ipRevenue] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: {
          id: { in: purchaseIds },
          sourceType: 'story_content_purchase',
        },
        select: { id: true, metadata: true },
      }),
      this.prisma.ipRevenueLedgerEntry.findMany({
        where: {
          userId,
          walletTransactionId: { in: items.map((r) => r.transactionId) },
        },
        select: {
          walletTransactionId: true,
          sourceAmount: true,
          order: { select: { orderNo: true } },
          episodeId: true,
        },
      }),
    ]);
    const episodes = await this.prisma.ipEpisodeLocalization.findMany({
      where: {
        episodeId: {
          in: ipRevenue
            .map((r) => r.episodeId)
            .filter((id): id is string => !!id),
        },
        archivedAt: null,
      },
      select: { episodeId: true, locale: true, title: true },
      orderBy: { locale: 'asc' },
    });
    return {
      lifetimeEarned: (totals._sum.amount ?? 0n).toString(),
      withdrawableBalance: account.availableBalance.toString(),
      works: validWorks.map((w) => ({
        key: `${w.kind}:${w.id}`,
        kind: w.kind,
        title: titles.get(`${w.kind}:${w.id}`) || null,
      })),
      entries: items.map((row) => {
        const meta = metadata(row.transaction.metadata);
        const kind = row.reason === 'story_content_revenue' ? 'story' : 'ip';
        const workKey = `${kind}:${kind === 'story' ? string(meta.projectId) : string(meta.ipId)}`;
        const purchase = purchases.find(
          (p) => p.id === row.transaction.sourceId,
        );
        const purchaseMeta = purchase ? metadata(purchase.metadata) : {};
        const ip = ipRevenue.find(
          (r) => r.walletTransactionId === row.transactionId,
        );
        const nodeTitle =
          string(purchaseMeta.title) ??
          (typeof purchaseMeta.title === 'object' && purchaseMeta.title
            ? (string(metadata(purchaseMeta.title)[query.locale]) ??
              string(metadata(purchaseMeta.title)['en-US']))
            : null);
        const episode = episodes.filter((e) => e.episodeId === ip?.episodeId);
        return {
          id: row.id,
          kind,
          episodeId: ip?.episodeId ?? null,
          workKey,
          workTitle: titles.get(workKey) || null,
          contentTitle:
            kind === 'story'
              ? nodeTitle
              : ((
                  episode?.find((l) => l.locale === query.locale) ??
                  episode?.[0]
                )?.title ?? null),
          amount: row.amount.toString(),
          sourceAmount:
            kind === 'story'
              ? typeof purchaseMeta.communityPointPrice === 'number'
                ? String(purchaseMeta.communityPointPrice)
                : null
              : (ip?.sourceAmount?.toString() ?? null),
          orderNo: ip?.order?.orderNo ?? row.transaction.sourceId,
          transactionId: row.transactionId,
          status: row.transaction.status,
          createdAt: row.createdAt.toISOString(),
        };
      }),
      nextCursor: rows.length > query.limit ? items.at(-1)!.id : null,
    };
  }
}
