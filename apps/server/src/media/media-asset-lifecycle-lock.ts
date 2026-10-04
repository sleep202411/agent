import { Prisma } from '@prisma/client';

/** Serialize reference validation against retirement, until the caller commits. */
export async function lockMediaAssetReference(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  assetId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT id FROM media_assets WHERE id = ${assetId}::uuid FOR SHARE`;
}

/** Acquire in a stable order before checking references or retiring assets. */
export async function lockMediaAssetRetirement(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  assetIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(assetIds)].sort();
  if (!ids.length) return;
  await tx.$executeRaw(Prisma.sql`
    SELECT id FROM media_assets
    WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id FOR UPDATE
  `);
}

/** Lock a document's reference candidates in one query, in stable row order. */
export async function lockMediaAssetReferences(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  assetIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(assetIds)].sort();
  if (!ids.length) return;
  await tx.$executeRaw(Prisma.sql`
    SELECT id FROM media_assets
    WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id FOR SHARE
  `);
}
