import { z } from "zod";
const id = z.string().uuid();
export const canvasActorReceiptSchema = z
  .object({
    nodeId: id,
    actorId: id,
    name: z.string().min(1),
    mediaAssetId: id,
    url: z.string(),
  })
  .refine(
    (receipt) => receipt.url === `/aurora/media/assets/${receipt.mediaAssetId}/content`,
    "Actor media does not match its receipt."
  );
export type CanvasActorReceipt = z.infer<typeof canvasActorReceiptSchema>;
