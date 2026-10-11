import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
const receiptSchema = z.object({
  file: z.object({
    source: z.literal("upload"),
    mediaAssetId: z.string().uuid(),
    name: z.string().trim().min(1).max(256),
  }),
  attempted: z.boolean(),
});
export type UploadReceipt = z.infer<typeof receiptSchema>;
const record = z.object({ version: z.literal(1), receipt: receiptSchema.nullable() });
export function uploadReceipt(
  crewId: string,
  userId: string,
  generation: number,
  parentId: string | null,
  store: DurableRecord = durableRecord(
    "crew-file-attachment",
    userId,
    JSON.stringify([crewId, parentId])
  )
) {
  const current = () => {
    if (generation !== getAuthGeneration()) throw new Error("Upload session expired.");
  };
  const read = () => {
    current();
    const raw = store.read();
    return raw === null ? null : record.parse(JSON.parse(raw)).receipt;
  };
  return {
    read,
    save: (receipt: UploadReceipt) => {
      current();
      const next = receiptSchema.parse(receipt),
        previous = read();
      if (
        previous &&
        (previous.file.mediaAssetId !== next.file.mediaAssetId ||
          previous.file.name !== next.file.name ||
          (previous.attempted && !next.attempted))
      )
        throw new Error("Another upload is pending. Reopen this folder before continuing.");
      store.write(JSON.stringify({ version: 1, receipt: next }));
    },
    clear: (mediaAssetId: string) => {
      current();
      const previous = read();
      if (previous && previous.file.mediaAssetId !== mediaAssetId)
        throw new Error("Another upload is pending.");
      store.write(JSON.stringify({ version: 1, receipt: null }));
    },
  };
}
