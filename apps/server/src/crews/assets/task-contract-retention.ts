import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

/** Attach and retire under the same tree lock, so neither can race the other. */
export async function lockCrewContractAssets(
  tx: Prisma.TransactionClient,
  crewId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crew:asset-tree:${crewId}`})::bigint)`;
}

/** Call after authorization and under the Crew asset-tree transaction lock. */
export async function requireNoTaskContractReferences(
  tx: Prisma.TransactionClient,
  crewId: string,
  nodeIds: string[],
) {
  if (!nodeIds.length) return;
  // Archived/deleted tasks retain their contractual evidence too. Do not filter
  // by workflow or deletion status when deciding whether a file can disappear.
  const references = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM crew_tasks
    WHERE crew_id = ${crewId}
      AND (metadata->>'contractAssetNodeId' IN (${Prisma.join(nodeIds)})
        OR EXISTS (SELECT 1 FROM crew_task_contract_files f WHERE f.task_id=crew_tasks.id
          AND f.asset_node_id::text IN (${Prisma.join(nodeIds)})))
    LIMIT 1
  `);
  if (references.length) {
    throw new ConflictException({
      code: 'CREW_TASK_CONTRACT_LOCKED',
      message:
        'This file or folder contains an attached task contract and cannot be edited, moved or deleted.',
    });
  }
}

/** Validate availability while retaining the tree lock until attachment commits. */
export async function requireAvailableTaskContractAsset(
  tx: Prisma.TransactionClient,
  crewId: string,
  assetId: string,
) {
  await lockCrewContractAssets(tx, crewId);
  const node = await tx.crewAssetNode.findFirst({
    where: { id: assetId, crewId, status: 'active', kind: 'file' },
    select: { id: true },
  });
  if (!node)
    throw new BadRequestException({
      message: 'The contract file is unavailable in this crew.',
    });
}

/** Caller already validated file availability/permission under the asset tree lock. */
export async function recordTaskContractFile(
  tx: Prisma.TransactionClient,
  taskId: string,
  assetNodeId: string | null | undefined,
  userId: string,
) {
  if (!assetNodeId) return;
  await tx.$queryRaw`SELECT id FROM crew_asset_nodes WHERE id=${assetNodeId}::uuid FOR UPDATE`;
  await tx.$executeRaw`INSERT INTO crew_task_contract_files(id,task_id,asset_node_id,attached_by_user_id)
    VALUES (${randomUUID()}::uuid,${taskId}::uuid,${assetNodeId}::uuid,${userId})
    ON CONFLICT(task_id,asset_node_id) DO NOTHING`;
}
