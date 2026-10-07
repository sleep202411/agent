import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WalletLedgerService } from '../workspaces/wallet-ledger.service';

// Referral cash is already denominated in source currency minor units.
export async function availableReferralIncome(
  tx: Prisma.TransactionClient,
  userId: string,
  currency: string,
) {
  return tx.$queryRaw<{ id: string; available: string }[]>`SELECT i.id,
 (i.amount_minor-COALESCE(SUM(a.amount_minor) FILTER(WHERE w.status IN ('pending','processing','paid')),0))::text AS available
 FROM referral_reward_items i JOIN referral_rewards r ON r.id=i.reward_id
 LEFT JOIN referral_withdrawal_allocations a ON a.reward_item_id=i.id
 LEFT JOIN creator_withdrawals w ON w.id=a.withdrawal_id
 WHERE r.user_id=${userId} AND r.status='paid_out' AND i.granted_at IS NOT NULL
 AND i.payout_type='cash' AND COALESCE(i.currency,r.currency)=${currency}
 GROUP BY i.id ORDER BY i.granted_at,i.id`;
}
export async function reserveReferralIncome(
  tx: Prisma.TransactionClient,
  wallet: WalletLedgerService,
  userId: string,
  withdrawalId: string,
  amount: bigint,
  currency: string,
  earnings: { id: string; available: string }[],
) {
  if (amount === 0n) return;
  let remaining = amount;
  for (const e of earnings) {
    const free = BigInt(e.available);
    if (free <= 0n) continue;
    const take = free < remaining ? free : remaining;
    if (take === 0n) break;
    await tx.referralWithdrawalAllocation.create({
      data: {
        id: randomUUID(),
        withdrawalId,
        rewardItemId: e.id,
        amountMinor: take,
        currency,
      },
    });
    remaining -= take;
  }
  if (remaining !== 0n)
    throw new ConflictException(
      'Referral earnings changed. Review the withdrawal amount.',
    );
  await postReferralWithdrawal(
    tx,
    wallet,
    userId,
    withdrawalId,
    amount,
    currency,
    'hold',
  );
}
export async function resolveReferralIncome(
  tx: Prisma.TransactionClient,
  wallet: WalletLedgerService,
  userId: string,
  withdrawalId: string,
  currency: string,
  action: 'pay' | 'reject',
) {
  const rows = await tx.referralWithdrawalAllocation.findMany({
    where: { withdrawalId },
    select: { amountMinor: true },
  });
  const amount = rows.reduce((sum, row) => sum + row.amountMinor, 0n);
  if (amount > 0n)
    await postReferralWithdrawal(
      tx,
      wallet,
      userId,
      withdrawalId,
      amount,
      currency,
      action === 'pay' ? 'settle' : 'release',
    );
}
async function postReferralWithdrawal(
  tx: Prisma.TransactionClient,
  wallet: WalletLedgerService,
  userId: string,
  withdrawalId: string,
  amount: bigint,
  currency: string,
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
    sourceType: 'referral_withdrawal',
    sourceId: withdrawalId,
    reason: `referral_withdrawal_${entryType}`,
    idempotencyKey: `referral-withdrawal:${withdrawalId}:${entryType}`,
    actorUserId: userId,
    metadata: {
      currency,
      amountMinor: amount.toString(),
      credits: amount.toString(),
      minorUnitsPerCredit: 1,
    },
  });
}
export const referralTotalsSql = Prisma.sql`SELECT COALESCE(i.currency,r.currency) AS currency,
 COALESCE(SUM(i.amount_minor),0) AS confirmed, COALESCE(SUM(a.reserved),0) AS reserved,COALESCE(SUM(a.paid),0) AS paid
 FROM referral_reward_items i JOIN referral_rewards r ON r.id=i.reward_id LEFT JOIN (
 SELECT a.reward_item_id,SUM(a.amount_minor) FILTER(WHERE w.status IN ('pending','processing')) AS reserved,
 SUM(a.amount_minor) FILTER(WHERE w.status='paid') AS paid
 FROM referral_withdrawal_allocations a JOIN creator_withdrawals w ON w.id=a.withdrawal_id GROUP BY a.reward_item_id
 ) a ON a.reward_item_id=i.id WHERE r.status='paid_out' AND i.granted_at IS NOT NULL AND i.payout_type='cash' AND COALESCE(i.currency,r.currency) IN ('USD','CNY')`;
