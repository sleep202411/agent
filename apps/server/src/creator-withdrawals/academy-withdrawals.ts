import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WalletLedgerService } from '../workspaces/wallet-ledger.service';

// docs/MEMBERSHIP-SPEC.md: community_point = US$0.01. Only Academy
// HOMEWORK_REVIEW_INCOME is settled here; cash referral units can be CNY.
export async function availableAcademyIncome(
  tx: Prisma.TransactionClient,
  userId: string,
  currency: string,
) {
  if (currency !== 'USD') return [];
  return tx.$queryRaw<{ id: string; available: string }[]>`SELECT e.id,
 (e.teacher_credits - COALESCE(SUM(a.amount_minor) FILTER(WHERE w.status IN ('pending','processing','paid')),0))::text AS available
 FROM academy_enrollments e LEFT JOIN academy_withdrawal_allocations a ON a.enrollment_id=e.id
 LEFT JOIN creator_withdrawals w ON w.id=a.withdrawal_id
 WHERE e.teacher_id=${userId} AND e.status='approved'
 GROUP BY e.id ORDER BY e.reviewed_at,e.id`;
}
export async function reserveAcademyIncome(
  tx: Prisma.TransactionClient,
  wallet: WalletLedgerService,
  userId: string,
  withdrawalId: string,
  amount: bigint,
  earnings: { id: string; available: string }[],
) {
  if (amount === 0n) return;
  let remaining = amount;
  for (const e of earnings) {
    const free = BigInt(e.available);
    if (free <= 0n) continue;
    const take = free < remaining ? free : remaining;
    if (take === 0n) break;
    await tx.academyWithdrawalAllocation.create({
      data: {
        id: randomUUID(),
        withdrawalId,
        enrollmentId: e.id,
        amountMinor: take,
        currency: 'USD',
      },
    });
    remaining -= take;
  }
  if (remaining !== 0n)
    throw new ConflictException(
      'Teaching earnings changed. Review the withdrawal amount.',
    );
  await postAcademyWithdrawal(tx, wallet, userId, withdrawalId, amount, 'hold');
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
    select: { amountMinor: true },
  });
  const amount = rows.reduce((sum, row) => sum + row.amountMinor, 0n);
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
      currency: 'USD',
      amountMinor: amount.toString(),
      credits: amount.toString(),
      minorUnitsPerCredit: 1,
    },
  });
}
export const academyTotalsSql = Prisma.sql`SELECT 'USD' AS currency,
 COALESCE(SUM(e.teacher_credits),0) AS confirmed,
 COALESCE(SUM(a.reserved),0) AS reserved,
 COALESCE(SUM(a.paid),0) AS paid
 FROM academy_enrollments e LEFT JOIN (
 SELECT a.enrollment_id,
 SUM(a.amount_minor) FILTER(WHERE w.status IN ('pending','processing')) AS reserved,
 SUM(a.amount_minor) FILTER(WHERE w.status='paid') AS paid
 FROM academy_withdrawal_allocations a JOIN creator_withdrawals w ON w.id=a.withdrawal_id GROUP BY a.enrollment_id
 ) a ON a.enrollment_id=e.id WHERE e.status='approved'`;
