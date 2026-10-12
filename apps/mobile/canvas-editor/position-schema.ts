import { canvasGroups } from "./group-schema";
import { z } from "zod";
export const canvasPositionEditSchema = z
  .object({
    action: z.literal("moveNodes"),
    groupId: z.string().min(1).optional(),
    positions: z
      .array(
        z
          .object({
            nodeId: z.string().min(1),
            x: z.number().finite(),
            y: z.number().finite(),
          })
          .strict()
      )
      .min(1)
      .refine(
        (items) => new Set(items.map((item) => item.nodeId)).size === items.length,
        "A canvas node may only be moved once per command."
      ),
  })
  .strict();
export type CanvasPositionEdit = z.infer<typeof canvasPositionEditSchema>;

export function validateMovementGroup(
  groups: Record<string, unknown>,
  nodeIds: Iterable<string>,
  edit: CanvasPositionEdit
) {
  if (!edit.groupId) return;
  const group = canvasGroups(groups, nodeIds).find((group) => group.id === edit.groupId);
  const ids = new Set(edit.positions.map((position) => position.nodeId));
  if (!group || group.nodeIds.length !== ids.size || group.nodeIds.some((id) => !ids.has(id)))
    throw Error("Canvas group membership changed. Discard the saved movement and try again.");
}
