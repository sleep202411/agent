import { z } from "zod";
import { durableRecord } from "@/lib/durable-record";
import { durableRecordKey } from "@/lib/durable-record-key";
import { channelVideoInput } from "./channel-videos-api";

const metadata = channelVideoInput.omit({ assetId: true });
const confirmation = z
  .object({
    storageKey: z.string().min(1),
    kind: z.literal("episode_video"),
    contentType: z.enum(["video/mp4", "video/quicktime", "video/webm"]),
  })
  .strict();
const operation = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("confirm"), metadata, confirmation }).strict(),
  z.object({ stage: z.literal("submit"), input: channelVideoInput }).strict(),
]);
export type ChannelVideoDraft = z.infer<typeof operation>;
/** Persist each irreversible boundary before sending the next write. A restored
 * submit operation keeps its original asset and text for server deduplication. */
export function channelVideoDraftStorage(userId: string, ipId: string) {
  z.string().min(1).parse(userId);
  z.string().uuid().parse(ipId);
  const scope = durableRecordKey("channel-video-draft", userId, ipId);
  const storage = durableRecord("channel-video-draft", userId, ipId);
  const record = z.object({ version: z.literal(1), scope: z.literal(scope), operation }).strict();
  return {
    read(): ChannelVideoDraft | null {
      const raw = storage.read();
      return raw === null || raw === "null" ? null : record.parse(JSON.parse(raw)).operation;
    },
    save(value: ChannelVideoDraft) {
      storage.write(JSON.stringify(record.parse({ version: 1, scope, operation: value })));
    },
    clear() {
      storage.write("null");
    },
  };
}
