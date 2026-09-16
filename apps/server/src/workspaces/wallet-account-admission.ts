import { WalletAccountStatus, type Prisma } from '@prisma/client';

/** Insert only when absent; never reactivate or reset an existing wallet. */
export async function ensureWalletAccount(
  client: Pick<Prisma.TransactionClient, 'walletAccount'>,
  identity: Prisma.WalletAccountOwnerTypeOwnerIdCurrencyBalanceKindCompoundUniqueInput,
) {
  await client.walletAccount.createMany({
    data: [{ ...identity, status: WalletAccountStatus.active }],
    skipDuplicates: true,
  });
  return client.walletAccount.findUniqueOrThrow({
    where: { ownerType_ownerId_currency_balanceKind: identity },
  });
}
