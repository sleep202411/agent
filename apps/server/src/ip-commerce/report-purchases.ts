import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../infra/db/db.module';
import type { ListReportPurchasesQuery } from './dto';

const purchaseSelect = {
  id: true,
  orderNo: true,
  ipId: true,
  episodeId: true,
  targetType: true,
  currency: true,
  totalAmount: true,
  status: true,
  createdAt: true,
} satisfies Prisma.IpPurchaseOrderSelect;
export async function listReportPurchases(
  db: PrismaService,
  userId: string,
  query: ListReportPurchasesQuery,
) {
  const term = query.query?.trim();
  const isUuid =
    term &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      term,
    );
  const scope: Prisma.IpPurchaseOrderWhereInput = {
    userId,
    ...(term
      ? {
          OR: [
            { orderNo: { contains: term, mode: 'insensitive' } },
            ...(isUuid ? [{ id: term }, { walletTransactionId: term }] : []),
          ],
        }
      : {}),
  };
  if (
    query.cursor &&
    !(await db.ipPurchaseOrder.findFirst({
      where: { ...scope, id: query.cursor },
      select: { id: true },
    }))
  )
    throw new BadRequestException(
      'Restart the purchase search to refresh your records.',
    );
  const rows = await db.ipPurchaseOrder.findMany({
    where: { ...scope, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
    select: purchaseSelect,
    orderBy: { id: 'desc' },
    take: query.limit + 1,
  });
  return {
    items: rows.slice(0, query.limit).map((row) => ({
      ...row,
      totalAmount: row.totalAmount.toString(),
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
  };
}
export async function requireReportPurchase(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  targetType: string,
  targetId: string,
) {
  // Lock before validation; report creation and its database guard bind exactly
  // this owned purchase, including content that is no longer publicly listed.
  const rows = await tx.$queryRaw<
    { ipId: string; episodeId: string | null; targetType: string }[]
  >`SELECT ip_id AS "ipId",episode_id AS "episodeId",target_type::text AS "targetType" FROM ip_purchase_orders WHERE id=${id}::uuid AND user_id=${userId} FOR SHARE`;
  const row = rows[0];
  if (
    !row ||
    row.targetType !== targetType ||
    (row.episodeId ?? row.ipId) !== targetId
  )
    throw new NotFoundException('Purchase not found for this report.');
  return { ipId: row.ipId, episodeId: row.episodeId };
}
