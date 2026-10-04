import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import {
  canvasGroups,
  canvasGroupEditSchema,
  type CanvasGroupEdit,
} from "../../../../canvas-editor/group-schema";
import { canvasUpdateSchema, type CanvasSnapshot } from "../../../../canvas-editor/protocol";
import type { CanvasWriteScope } from "../api/story-canvas-update";

export const canvasGroupDraftSchema = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("selection"), nodeIds: z.array(z.string().min(1)) }).strict(),
  z
    .object({
      stage: z.literal("action"),
      edit: canvasGroupEditSchema,
      baseline: z.string(),
      command: canvasUpdateSchema.optional(),
    })
    .strict(),
]);
export type CanvasGroupDraft = z.infer<typeof canvasGroupDraftSchema>;
export function canvasGroupBaseline(snapshot: CanvasSnapshot, raw: CanvasGroupEdit) {
  const edit = canvasGroupEditSchema.parse(raw);
  const groups = canvasGroups(snapshot.groups, Object.keys(snapshot.nodes));
  const target = "groupId" in edit ? groups.find((group) => group.id === edit.groupId) : undefined;
  if ("groupId" in edit && edit.operation !== "create" && !target)
    throw Error("The canvas group changed. Reload the document.");
  const selected = "nodeIds" in edit ? edit.nodeIds : target!.nodeIds;
  const nodes = selected.map((id) =>
    z
      .object({
        id: z.literal(id),
        position:
          edit.operation === "move"
            ? z.object({ x: z.number().finite(), y: z.number().finite() })
            : z.unknown().optional(),
      })
      .parse(snapshot.nodes[id])
  );
  if (edit.operation === "move")
    return JSON.stringify({
      members: target!.nodeIds,
      positions: nodes.map((node) => ({ id: node.id, position: node.position })),
    });
  if (edit.operation === "color" || edit.operation === "ungroup") return JSON.stringify(target);
  return JSON.stringify({
    groups,
    selected: nodes.map((node) => node.id),
    collision: edit.operation === "create" && Object.hasOwn(snapshot.groups, edit.groupId),
  });
}
export function canvasGroupDraftStore(
  scope: CanvasWriteScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-canvas-group-draft",
    userId,
    `${scope.projectId}:${scope.documentId}`
  )
) {
  const current = () => {
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  return {
    read: () => {
      current();
      const raw = storage.read();
      return raw === null
        ? null
        : z
            .object({ version: z.literal(1), draft: canvasGroupDraftSchema.nullable() })
            .parse(JSON.parse(raw)).draft;
    },
    write: (draft: CanvasGroupDraft | null) => {
      current();
      storage.write(
        JSON.stringify({
          version: 1,
          draft: draft === null ? null : canvasGroupDraftSchema.parse(draft),
        })
      );
    },
  };
}
