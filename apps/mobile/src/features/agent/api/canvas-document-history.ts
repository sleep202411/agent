import { z } from "zod";
import { api } from "@/lib/api-client";
import { encodedCanvasState } from "../../../../canvas-editor/protocol";

const operationSchema = z
  .object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    sequence: z.number().int().positive(),
    operationType: z.enum(["yjs_update", "patch", "snapshot", "comment", "system"]),
    yjsUpdateBase64: encodedCanvasState.nullish(),
  })
  .refine(
    (value) => value.operationType !== "yjs_update" || !!value.yjsUpdateBase64,
    "Canvas update is missing CRDT data."
  );
export type CanvasHistoryOperation = z.infer<typeof operationSchema>;
type Horizon = { id: string; currentSequence: number; snapshotSequence: number };
export type CanvasDocumentState<D extends Horizon> = {
  document: D;
  operations: CanvasHistoryOperation[];
  sequence: number;
};
class HorizonChanged extends Error {}

/** Ownership is checked by each caller's document loader. This shared transport
 * never rebases partial history onto a different document or compacted snapshot. */
export async function synchronizeCanvasHistory<D extends Horizon>(
  initial: D,
  signal: AbortSignal,
  current: () => void,
  reload: (documentId: string) => Promise<D>
): Promise<CanvasDocumentState<D>> {
  let document = initial;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const operations: CanvasHistoryOperation[] = [],
        seen = new Set<string>();
      let cursor = document.snapshotSequence;
      while (cursor < document.currentSequence) {
        current();
        const raw = await api.get(`/documents/${document.id}/operations`, {
          service: "aurora",
          signal,
          retry: false,
          params: { afterSequence: cursor, limit: 500 },
        });
        current();
        const page = z
          .object({ operations: z.array(operationSchema).max(500) })
          .parse(raw).operations;
        if (!page.length) throw new HorizonChanged();
        for (const operation of page) {
          if (operation.documentId !== document.id || seen.has(operation.id))
            throw Error("Canvas operation identity mismatch.");
          if (operation.sequence !== cursor + 1) throw new HorizonChanged();
          if (operation.operationType === "patch" || operation.operationType === "snapshot")
            throw new HorizonChanged();
          seen.add(operation.id);
          operations.push(operation);
          cursor = operation.sequence;
          if (cursor === document.currentSequence) break;
        }
      }
      current();
      return { document, operations, sequence: cursor };
    } catch (error) {
      if (!(error instanceof HorizonChanged)) throw error;
      if (attempt === 2) break;
      const fresh = await reload(document.id);
      if (fresh.id !== initial.id) throw Error("Canvas document identity changed.");
      if (fresh.currentSequence < document.currentSequence)
        throw Error("Canvas document sequence regressed.");
      document = fresh;
    }
  }
  throw Error("Canvas history changed during loading. Reload the document.");
}
