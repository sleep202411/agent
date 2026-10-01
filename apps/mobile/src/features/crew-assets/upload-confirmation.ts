import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { confirmMobileMediaUpload } from "@/lib/media-upload";
const schema = z.object({
  name: z.string().trim().min(1).max(256),
  request: z.object({
    storageKey: z.string().min(1).max(2048),
    kind: z.literal("crew_asset_file"),
    contentType: z.string().min(1).max(256),
    scope: z.object({ crewId: z.string().min(1).max(64) }),
  }),
});
export type UploadConfirmation = z.infer<typeof schema>;
const record = z.object({ version: z.literal(1), pending: schema.nullable() });
export function uploadConfirmation(
  crewId: string,
  userId: string,
  generation: number,
  parentId: string | null,
  store: DurableRecord = durableRecord(
    "crew-upload-confirmation",
    userId,
    JSON.stringify([crewId, parentId])
  )
) {
  const check = () => {
    if (generation !== getAuthGeneration()) throw new Error("Upload session expired.");
  };
  const parse = (value: unknown) => {
    const parsed = schema.parse(value);
    if (parsed.request.scope.crewId !== crewId) throw new Error("Upload Crew scope mismatch.");
    return parsed;
  };
  const read = () => {
    check();
    const raw = store.read();
    const pending = raw === null ? null : record.parse(JSON.parse(raw)).pending;
    return pending === null ? null : parse(pending);
  };
  return {
    read,
    save(value: unknown) {
      check();
      const next = parse(value),
        previous = read();
      if (previous && JSON.stringify(previous) !== JSON.stringify(next))
        throw new Error("Another upload confirmation is pending.");
      store.write(JSON.stringify({ version: 1, pending: next }));
    },
    clear(storageKey: string) {
      const previous = read();
      if (previous && previous.request.storageKey !== storageKey)
        throw new Error("Another upload confirmation is pending.");
      store.write(JSON.stringify({ version: 1, pending: null }));
    },
    async recover(signal: AbortSignal, expectedKey?: string) {
      const pending = read();
      if (!pending) throw new Error("No upload confirmation to recover.");
      if (expectedKey && pending.request.storageKey !== expectedKey)
        throw new Error("Another upload confirmation is pending.");
      const result = await confirmMobileMediaUpload(pending.request, signal);
      check();
      return {
        source: "upload" as const,
        name: pending.name,
        mediaAssetId: z.string().uuid().parse(result.mediaAssetId),
      };
    },
  };
}
