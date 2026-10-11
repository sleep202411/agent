import { z } from "zod";
import { PutStoryStoryboardTimelineSchema } from "@repo/shared";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { saveTimeline, type TimelineInput, type TimelineScope } from "./story-timeline-api";
const schema = z
  .object({
    version: z.literal(1),
    sequenceId: z.string().uuid(),
    clientKey: z.string().uuid(),
    input: z.unknown(),
  })
  .strict();
export type PendingTimeline = {
  version: 1;
  sequenceId: string;
  clientKey: string;
  input: TimelineInput;
};
export function timelinePending(
  scope: TimelineScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-timeline",
    userId,
    `${scope.projectId}:${scope.chapterId}`
  )
) {
  const current = () => {
    if (!userId || scope.generation !== getAuthGeneration())
      throw Error("Timeline session expired.");
  };
  const parse = (value: unknown): PendingTimeline => {
    const data = schema.parse(value);
    return { ...data, input: PutStoryStoryboardTimelineSchema.parse(data.input) };
  };
  const read = () => {
    current();
    const raw = storage.read();
    return raw === null || raw === "null" ? null : parse(JSON.parse(raw));
  };
  const save = (value: PendingTimeline) => {
    current();
    const command = parse(value),
      old = read();
    if (old && JSON.stringify(old) !== JSON.stringify(command))
      throw Error("A timeline save is pending. Resolve it before editing another timeline.");
    storage.write(JSON.stringify(command));
    return command;
  };
  const clear = (clientKey: string) => {
    const old = read();
    if (old && old.clientKey !== clientKey) throw Error("A different timeline save is pending.");
    storage.write("null");
  };
  return {
    read,
    save,
    clear,
    submit: async (value: PendingTimeline) => {
      const command = save(value); // Durable write must succeed before the network mutation.
      const result = await saveTimeline(
        scope,
        command.sequenceId,
        `timeline:${command.clientKey}`,
        command.input
      );
      clear(command.clientKey);
      return result;
    },
  };
}
