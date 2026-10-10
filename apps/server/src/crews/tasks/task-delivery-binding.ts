import { Prisma } from '@prisma/client';

export function taskDeliveryCategoryKey(task: {
  taskKind?: string | null;
  metadata?: unknown;
}): string | undefined {
  const meta =
    task.metadata && typeof task.metadata === 'object'
      ? (task.metadata as Record<string, unknown>)
      : {};
  if (typeof meta.deliveryCategoryKey === 'string')
    return meta.deliveryCategoryKey;
  if (!task.taskKind) return undefined;
  if (task.taskKind === 'art')
    return (
      (
        {
          characters: 'character_art_delivery',
          scenes: 'scene_art_delivery',
          props: 'prop_art_delivery',
        } as Record<string, string>
      )[String(meta.assetCategory)] ?? 'art_delivery'
    );
  return (
    (
      {
        script: 'script_delivery',
        storyboard: 'storyboard_delivery',
        edit: 'assembly_delivery',
      } as Record<string, string>
    )[task.taskKind] ?? `${task.taskKind}_delivery`
  );
}

/** Only call during creation: existing tasks retain their agreed revision. */
export async function bindNewTaskDeliveryTemplate(
  tx: Prisma.TransactionClient,
  task: { id: string; taskKind?: string | null; metadata?: unknown },
) {
  await bindTaskDeliveryCategoryKey(tx, task.id, taskDeliveryCategoryKey(task));
}

export async function bindTaskDeliveryCategoryKey(
  tx: Prisma.TransactionClient,
  taskId: string,
  deliveryCategoryKey?: string,
) {
  if (!deliveryCategoryKey) return;
  const row = await findActiveDeliveryCategory(tx, deliveryCategoryKey);
  if (row) {
    await tx.$executeRaw`INSERT INTO crew_task_delivery_templates(task_id, category_id, category_version)
      VALUES (${taskId}::uuid, ${row.category_id}::uuid, ${row.version})
      ON CONFLICT DO NOTHING`;
  }
}

export async function findActiveDeliveryCategory(
  tx: Prisma.TransactionClient,
  deliveryCategoryKey: string,
  excludeId?: string,
) {
  const [row] = await tx.$queryRaw<
    Array<{ category_id: string; version: number }>
  >`SELECT category_id, version
    FROM (SELECT DISTINCT ON (category_id) category_id, version, definition
      FROM crew_delivery_catalog_revisions ORDER BY category_id, version DESC) latest
    WHERE category_id != ${excludeId ?? '00000000-0000-0000-0000-000000000000'}::uuid AND definition->>'status' = 'active'
      AND definition->>'categoryKey' = ${deliveryCategoryKey}
    ORDER BY version DESC LIMIT 1`;
  return row;
}
