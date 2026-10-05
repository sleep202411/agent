import { BadRequestException } from '@nestjs/common';
import { CrewAssetPermission, type Prisma } from '@prisma/client';
import { availableCrewAssetName } from '../assets/asset-name';
import { lockCrewAssetFolderNames } from '../assets/upload-lock';
import type { CrewAssetAccessService } from '../assets/asset-access.service';
import { taskAssetCategory } from './task-asset-category';

type DeliveryTask = {
  id: string;
  crewId: string;
  title: string;
  taskKind?: string | null;
  metadata?: unknown;
};

function deliveryCategoryKey(task: DeliveryTask): string | null {
  if (task.taskKind === 'voice') return 'music.voices';
  const category = taskAssetCategory(task.metadata, task.taskKind ?? null);
  return (
    (
      {
        scripts: 'script',
        characters: 'art.characters',
        scenes: 'art.scenes',
        props: 'art.props',
        art: 'art',
        music: 'music',
        production: 'video',
      } as Record<string, string>
    )[category] ?? null
  );
}

/** Organizational provisioning is part of an already-authorized task creation.
 * The new folder inherits its category ACL; this grants no upload or read access. */
export function provisionTaskDeliveryFolderTx(
  tx: Prisma.TransactionClient,
  task: DeliveryTask,
  userId: string,
) {
  return resolveTaskDeliveryFolderTx(tx, undefined, task, userId);
}

/** Called within the task write transaction, after its task serialization lock. */
export function taskDeliveryFolderTx(
  tx: Prisma.TransactionClient,
  access: CrewAssetAccessService,
  task: DeliveryTask,
  userId: string,
  requestedFolderId?: string,
) {
  return resolveTaskDeliveryFolderTx(
    tx,
    access,
    task,
    userId,
    requestedFolderId,
  );
}
async function resolveTaskDeliveryFolderTx(
  tx: Prisma.TransactionClient,
  access: CrewAssetAccessService | undefined,
  task: DeliveryTask,
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
    await access?.requireContainerPermission(
      task.crewId,
      folderId,
      userId,
      CrewAssetPermission.upload,
      tx,
    );
    selectedId = folder.id;
  } else {
    // Stable seeded keys survive renaming/localization. Never infer a folder
    // from its displayed name or silently route around a restricted folder.
    const categoryKey = deliveryCategoryKey(task);
    const category = categoryKey
      ? await tx.crewAssetNode.findFirst({
          where: {
            crewId: task.crewId,
            folderKey: categoryKey,
            kind: 'folder',
          },
          select: { id: true, status: true },
        })
      : null;
    if (category && category.status !== 'active')
      throw new BadRequestException(
        'The task category folder is unavailable. Restore it or update the task delivery folder.',
      );
    const parentId = category?.id ?? null;
    await access?.requireContainerPermission(
      task.crewId,
      parentId,
      userId,
      CrewAssetPermission.upload,
      tx,
    );
    await lockCrewAssetFolderNames(tx, task.crewId, parentId);
    const siblings = await tx.crewAssetNode.findMany({
      where: { crewId: task.crewId, parentId, status: 'active' },
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
        parentId,
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
  task: DeliveryTask,
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
