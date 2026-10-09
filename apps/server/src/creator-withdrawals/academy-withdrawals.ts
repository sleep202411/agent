import {
  type AcademyQuote,
  USD_ACADEMY_QUOTE,
  FX_SCALE,
  rateUnits,
  cashForCredits,
  assertQuoteCurrent,
} from './academy-fx';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WalletLedgerService } from '../workspaces/wallet-ledger.service';

// Expand the immutable enrollment snapshot, including legacy single-instructor rows.
// A withdrawal belongs to its recipient, not to the enrollment's primary reviewer.
export const academyPayeesSql = Prisma.sql`SELECT enrollment.id, enrollment.status,
 enrollment.reviewed_at, share->>'teacherId' AS teacher_id,
 (share->>'credits')::bigint AS teacher_credits
 FROM academy_enrollments enrollment CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(enrollment.instructor_shares)='array'
 AND enrollment.instructor_shares <> '[]'::jsonb THEN enrollment.instructor_shares
 ELSE jsonb_build_array(jsonb_build_object('teacherId',enrollment.teacher_id,
 'credits',enrollment.teacher_credits::text)) END
 ) share`;

export type AcademyIncome = {
  id: string;
  available: string;
  availableCredits?: string;
  quote?: AcademyQuote;
};
export async function availableAcademyIncome(
  tx: Prisma.TransactionClient,
  userId: string,
  currency: string,
  quote: AcademyQuote | null = USD_ACADEMY_QUOTE,
): Promise<AcademyIncome[]> {
  if (!quote || currency !== quote.currency) return [];
  assertQuoteCurrent(quote);
  const rows = await tx.$queryRaw<
    { id: string; credits: string }[]
  >`SELECT e.id,
 (e.teacher_credits - COALESCE(SUM(COALESCE(a.source_credits,a.amount_minor)) FILTER(WHERE w.status IN ('pending','processing','paid') AND w.user_id=${userId}),0))::text AS credits
 FROM (${academyPayeesSql}) e LEFT JOIN academy_withdrawal_allocations a ON a.enrollment_id=e.id
 LEFT JOIN creator_withdrawals w ON w.id=a.withdrawal_id
 WHERE e.teacher_id=${userId} AND e.status='approved'
 GROUP BY e.id,e.teacher_credits,e.reviewed_at ORDER BY e.reviewed_at,e.id`;
  return rows.map((row) => ({
    id: row.id,
    availableCredits: row.credits,
    available: cashForCredits(
      BigInt(row.credits) > 0n ? BigInt(row.credits) : 0n,
      quote,
    ).toString(),
    quote,
  }));
}

/** Only whole earned points are held; unconsumed points stay available.
 * Cash rounds down to a minor unit, never above the requested percentage. */
export function planAcademyIncome(amount: bigint, earnings: AcademyIncome[]) {
  let remaining = amount;
  const allocations: {
    id: string;
    credits: bigint;
    amount: bigint;
    quote: AcademyQuote;
  }[] = [];
  for (const e of earnings) {
    if (remaining <= 0n) break;
    const quote = e.quote ?? USD_ACADEMY_QUOTE;
    assertQuoteCurrent(quote);
    const free = BigInt(e.availableCredits ?? e.available);
    if (free <= 0n) continue;
    const affordable =
      ((remaining + 1n) * FX_SCALE - 1n) / rateUnits(quote.rate);
    const maximumCredits = free < affordable ? free : affordable;
    const cash = cashForCredits(maximumCredits, quote);
    // Hold the fewest whole points that fund this cash amount.
    const units = rateUnits(quote.rate);
    const credits = (cash * FX_SCALE + units - 1n) / units;
    if (cash <= 0n) continue;
    allocations.push({ id: e.id, credits, amount: cash, quote });
    remaining -= cash;
  }
  return { allocations, amount: amount - remaining };
}
export async function reserveAcademyIncome(
  tx: Prisma.TransactionClient,
  wallet: WalletLedgerService,
  userId: string,
  withdrawalId: string,
  amount: bigint,
  earnings: AcademyIncome[],
) {
  if (amount === 0n) return;
  const plan = planAcademyIncome(amount, earnings);
  if (plan.amount !== amount)
    throw new ConflictException(
      'Teaching earnings changed. Review the withdrawal amount.',
    );
  for (const item of plan.allocations) {
    await tx.academyWithdrawalAllocation.create({
      data: {
        id: randomUUID(),
        withdrawalId,
        enrollmentId: item.id,
        amountMinor: item.amount,
        currency: item.quote.currency,
        sourceCredits: item.credits,
        exchangeRate: item.quote,
      },
    });
  }
  const credits = plan.allocations.reduce(
    (sum, item) => sum + item.credits,
    0n,
  );
  await postAcademyWithdrawal(
    tx,
    wallet,
    userId,
    withdrawalId,
    credits,
    'hold',
  );
}
export async function resolveAcademyIncome(
  tx: Prisma.TransactionClient,
  wallet: WalletLedgerService,
  userId: string,
  withdrawalId: string,
  action: 'pay' | 'reject',
) {
  const rows = await tx.academyWithdrawalAllocation.findMany({
    where: { withdrawalId },
    select: { amountMinor: true, sourceCredits: true },
  });
  const amount = rows.reduce(
    (sum, row) => sum + (row.sourceCredits ?? row.amountMinor),
    0n,
  );
  if (amount > 0n)
    await postAcademyWithdrawal(
      tx,
      wallet,
      userId,
      withdrawalId,
      amount,
      action === 'pay' ? 'settle' : 'release',
    );
}
async function postAcademyWithdrawal(
  tx: Prisma.TransactionClient,
  wallet: WalletLedgerService,
  userId: string,
  withdrawalId: string,
  amount: bigint,
  entryType: 'hold' | 'settle' | 'release',
) {
  const account = await tx.walletAccount.findUniqueOrThrow({
    where: {
      ownerType_ownerId_currency_balanceKind: {
        ownerType: 'user',
        ownerId: userId,
        currency: 'community_point',
        balanceKind: 'withdrawable',
      },
    },
  });
  await wallet.postEntryTx(tx, {
    accountId: account.id,
    entryType,
    amount,
    availableDelta:
      entryType === 'hold' ? -amount : entryType === 'release' ? amount : 0n,
    heldDelta: entryType === 'hold' ? amount : -amount,
    sourceType: 'academy_withdrawal',
    sourceId: withdrawalId,
    reason: `academy_withdrawal_${entryType}`,
    idempotencyKey: `academy-withdrawal:${withdrawalId}:${entryType}`,
    actorUserId: userId,
    metadata: {
      credits: amount.toString(),
      settlement:
        'Per-source currency and exchange-rate snapshots are retained in Academy allocations.',
    },
  });
}
export function academyTotals(quote: AcademyQuote | null) {
  const currency = quote?.currency ?? 'CNY';
  const units = quote ? rateUnits(quote.rate) : 0n;
  return Prisma.sql`SELECT e.currency,
 COALESCE(SUM(e.available+e.reserved+e.paid),0) AS confirmed,
 COALESCE(SUM(e.reserved),0) AS reserved, COALESCE(SUM(e.paid),0) AS paid
 FROM (
 SELECT payee.teacher_id,payee.status,c.currency,
 CASE WHEN c.currency=${currency} THEN floor(GREATEST(payee.teacher_credits-COALESCE(used.credits,0),0)*${units}::numeric/${FX_SCALE}::numeric) ELSE 0 END AS available,
 COALESCE(cash.reserved,0) AS reserved,COALESCE(cash.paid,0) AS paid
 FROM (${academyPayeesSql}) payee CROSS JOIN (VALUES ('USD'),('CNY')) c(currency)
 LEFT JOIN LATERAL (
 SELECT SUM(COALESCE(a.source_credits,a.amount_minor)) AS credits
 FROM academy_withdrawal_allocations a JOIN creator_withdrawals w ON w.id=a.withdrawal_id
 WHERE a.enrollment_id=payee.id AND w.user_id=payee.teacher_id AND w.status IN ('pending','processing','paid')
 ) used ON true
 LEFT JOIN LATERAL (
 SELECT SUM(a.amount_minor) FILTER(WHERE w.status IN ('pending','processing')) AS reserved,
 SUM(a.amount_minor) FILTER(WHERE w.status='paid') AS paid
 FROM academy_withdrawal_allocations a JOIN creator_withdrawals w ON w.id=a.withdrawal_id
 WHERE a.enrollment_id=payee.id AND w.user_id=payee.teacher_id AND a.currency=c.currency
 ) cash ON true
 WHERE c.currency=${currency} OR COALESCE(cash.reserved,0)>0 OR COALESCE(cash.paid,0)>0
 ) e WHERE e.status='approved'`;
}
