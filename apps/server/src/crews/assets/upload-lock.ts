import { Prisma } from '@prisma/client';

/**
 * A confirmed crew upload has a short unclaimed phase before either the asset
 * center or a chat message creates its CrewAssetNode. Claim and discard paths
 * take the same transaction-scoped lock so cleanup can never delete an object
 * that another request is concurrently making visible.
 */
export async function lockCrewAssetUploads(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  mediaAssetIds: string[],
): Promise<void> {
  const ids = [...new Set(mediaAssetIds)].sort();
  for (const mediaAssetId of ids) {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(
        hashtextextended(${`crew-asset-upload:${mediaAssetId}`}, 0)
      )`,
    );
  }
}

/**
 * Serializes name allocation inside one crew folder. Uploads run concurrently
 * in the browser, so checking for an available name without this lock would
 * still race at the partial unique index.
 */
export async function lockCrewAssetFolderNames(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  crewId: string,
  parentId: string | null,
): Promise<void> {
  // Chat and task attachments predate nested folders and already use this
  // root namespace. Sharing the key prevents cross-feature name races.
  const lockKey = parentId
    ? `crew-asset-folder-names:${crewId}:${parentId}`
    : `crew-asset-root-names:${crewId}`;
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${lockKey}, 0)
    )`,
  );
}
