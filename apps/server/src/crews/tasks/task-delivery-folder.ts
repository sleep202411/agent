import { BadRequestException } from '@nestjs/common';
import { CrewAssetPermission, type Prisma } from '@prisma/client';
import { availableCrewAssetName } from '../assets/asset-name';
import { lockCrewAssetFolderNames } from '../assets/upload-lock';
import type { CrewAssetAccessService } from '../assets/asset-access.service';

/** Called within the task write transaction, after its task serialization lock. */
export async function taskDeliveryFolderTx(
  tx: Prisma.TransactionClient,
  access: CrewAssetAccessService,
  task: { id: string; crewId: string; title: string },
  userId: string,
  requestedFolderId?: string,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crew:asset-tree:${task.crewId}`})::bigint)`;
  const links = await tx.$queryRaw<Array<{ folderId: string }>>`
    SELECT folder_id AS "folderId" FROM crew_task_delivery_folders WHERE task_id = ${task.id}::uuid AND crew_id = ${task.crewId}
  `;
  const folderId = requestedFolderId ?? links[0]?.folderId;
  let selectedId: string;
  if (folderId) {
    const folder = await tx.crewAssetNode.findFirst({
      where: {
        id: folderId,
        crewId: task.crewId,
        kind: 'folder',
        status: 'active',
      },
    });
    if (!folder)
      throw new BadRequestException(
        'The task delivery folder is unavailable. Select an active folder in this Crew.',
      );
    await access.requireContainerPermission(
      task.crewId,
      folderId,
      userId,
      CrewAssetPermission.upload,
      tx,
    );
    selectedId = folder.id;
  } else {
    await access.requireContainerPermission(
      task.crewId,
      null,
      userId,
      CrewAssetPermission.upload,
      tx,
    );
    await lockCrewAssetFolderNames(tx, task.crewId, null);
    const siblings = await tx.crewAssetNode.findMany({
      where: { crewId: task.crewId, parentId: null, status: 'active' },
      select: { name: true },
    });
    const name = availableCrewAssetName(
      task.title,
      new Set(siblings.map((node) => node.name.toLowerCase())),
    );
    const folder = await tx.crewAssetNode.create({
      data: {
        crewId: task.crewId,
        kind: 'folder',
        name,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
    selectedId = folder.id;
  }
  await tx.$executeRaw`
    INSERT INTO crew_task_delivery_folders (task_id, crew_id, folder_id, created_by_user_id)
    VALUES (${task.id}::uuid, ${task.crewId}, ${selectedId}::uuid, ${userId})
    ON CONFLICT (task_id) DO UPDATE SET folder_id = EXCLUDED.folder_id
  `;
  return selectedId;
}

/** Accepted files appear in the delivery folder as references. Original parents and ACLs remain authoritative. */
export async function publishTaskDeliveryAssetsTx(
  tx: Prisma.TransactionClient,
  access: CrewAssetAccessService,
  task: { id: string; crewId: string; title: string },
  userId: string,
  assetIds: string[],
) {
  if (!assetIds.length) return;
  await taskDeliveryFolderTx(tx, access, task, userId);
  await access.requireNodesPermission(
    task.crewId,
    assetIds,
    userId,
    CrewAssetPermission.view,
    tx,
  );
  const count = await tx.crewAssetNode.count({
    where: {
      id: { in: assetIds },
      crewId: task.crewId,
      kind: 'file',
      status: 'active',
    },
  });
  if (count !== new Set(assetIds).size)
    throw new BadRequestException(
      'One or more accepted assets are no longer available.',
    );
  for (const assetId of new Set(assetIds)) {
    await tx.$executeRaw`
      INSERT INTO crew_task_delivery_assets (task_id, crew_id, asset_node_id)
      VALUES (${task.id}::uuid, ${task.crewId}, ${assetId}::uuid)
      ON CONFLICT (task_id, asset_node_id) DO NOTHING
    `;
  }
}
