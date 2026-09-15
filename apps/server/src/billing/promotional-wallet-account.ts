import { ensureWalletAccount } from '../workspaces/wallet-account-admission';
import {
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
  return ensureWalletAccount(client, identity);
}
