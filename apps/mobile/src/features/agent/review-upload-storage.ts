import { z } from "zod";
import { durableRecord } from "@/lib/durable-record";
import { durableRecordKey } from "@/lib/durable-record-key";
import { reviewUploadCheckpointSchema, type ReviewUploadCheckpoint } from "./content-review-upload";
/** Each review operation owns a separate atomic record, isolated by account, region and workspace. */
export function reviewUploadStorage(userId: string, workspaceId: string, uploadId: string) {
  z.string().min(1).parse(userId);
  z.string().uuid().parse(workspaceId);
  z.string().uuid().parse(uploadId);
  const scope = durableRecordKey("content-review-upload", userId, workspaceId);
  const storage = durableRecord(
    "content-review-upload-parts",
    userId,
    JSON.stringify([workspaceId, uploadId])
  );
  function validate(value: unknown) {
    const checkpoint = reviewUploadCheckpointSchema.parse(value);
    if (checkpoint.scope !== scope || checkpoint.id !== uploadId)
      throw new Error("Saved upload scope mismatch");
    return checkpoint;
  }
  return {
    read(): ReviewUploadCheckpoint | null {
      const text = storage.read();
      return text === null || text === "null" ? null : validate(JSON.parse(text));
    },
    async save(checkpoint: ReviewUploadCheckpoint) {
      storage.write(JSON.stringify(validate(checkpoint)));
    },
    clear() {
      storage.write("null");
    },
  };
}
