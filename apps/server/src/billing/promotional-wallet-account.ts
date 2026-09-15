import {
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCurrencyType,
  WalletOwnerType,
  type Prisma,
} from '@prisma/client';

/** Admit concurrent reward claims without resetting an existing wallet. */
export async function ensurePromotionalWalletAccount(
  client: Pick<Prisma.TransactionClient, 'walletAccount'>,
  workspaceId: string,
) {
  const identity = {
    ownerType: WalletOwnerType.workspace,
    ownerId: workspaceId,
    currency: WalletCurrencyType.compute_point,
    balanceKind: WalletBalanceKind.consumable,
  };
  // Empty-update Prisma upserts can perform a read followed by an insert.
  // ON CONFLICT DO NOTHING makes first-use admission atomic across callers.
  await client.walletAccount.createMany({
    data: [{ ...identity, status: WalletAccountStatus.active }],
    skipDuplicates: true,
  });
  return client.walletAccount.findUniqueOrThrow({
    where: { ownerType_ownerId_currency_balanceKind: identity },
  });
}
