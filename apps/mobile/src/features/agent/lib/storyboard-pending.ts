import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { canvasUpdateSchema } from "../../../../canvas-editor/protocol";
import type { CanvasEditScope } from "./story-canvas-draft";
export function storyboardPending(
  scope: CanvasEditScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "storyboard-operation",
    userId,
    "kind" in scope
      ? `${scope.workspaceId}:${scope.projectId}:${scope.sectionId}:${scope.documentId}`
      : `${scope.projectId}:${scope.documentId}`
  )
) {
  const current = () => {
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  return {
    read() {
      current();
      const raw = storage.read();
      return raw ? canvasUpdateSchema.nullable().parse(JSON.parse(raw)) : null;
    },
    write(value: z.infer<typeof canvasUpdateSchema> | null) {
      current();
      storage.write(JSON.stringify(canvasUpdateSchema.nullable().parse(value)));
    },
  };
}
