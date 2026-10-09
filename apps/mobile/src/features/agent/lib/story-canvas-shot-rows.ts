import { compareByOrder } from "@repo/shared";
import { z } from "zod";
import type { CanvasSnapshot } from "../../../../canvas-editor/protocol";

/** Same derived row order as Web's storyboard; never persists row numbers. */
export function canvasShotRows(snapshot: CanvasSnapshot) {
  return Object.entries(snapshot.nodes)
    .filter(([, raw]) => (raw as { type?: unknown } | null)?.type === "shot")
    .map(([id, raw]) => {
      const node = z
        .object({
          id: z.literal(id),
          data: z.object({
            order: z.string().nullish(),
            label: z.string().nullish(),
          }),
        })
        .parse(raw);
      return { id, order: node.data.order, title: node.data.label || id };
    })
    .sort(compareByOrder);
}
