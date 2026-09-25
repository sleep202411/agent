import type { Prisma } from '@prisma/client';
import { ensureWalletAccount } from '../../workspaces/wallet-account-admission';

/** Workspace, owner and empty compute account commit with project initialization. */
export async function createCrewStudioWorkspaceTx(
  tx: Prisma.TransactionClient,
  userId: string,
  name: string,
) {
  const workspace = await tx.workspace.create({
    data: {
      name,
      ownerUserId: userId,
      createdById: userId,
      members: { create: { userId, role: 'owner', status: 'active' } },
    },
    select: { id: true, name: true },
  });
  await ensureWalletAccount(tx, {
    ownerType: 'workspace',
    ownerId: workspace.id,
    currency: 'compute_point',
    balanceKind: 'consumable',
  });
  return workspace;
}
