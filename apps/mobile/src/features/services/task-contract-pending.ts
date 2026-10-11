import { z } from "zod";
import { durableRecord } from "@/lib/durable-record";
import { contractSession } from "./task-contract-files-api";
const pending = z.object({ assetNodeId: z.string().uuid(), attempted: z.boolean() });
export type PendingContract = z.infer<typeof pending>;
export function taskContractPending(taskId: string, userId: string, generation: number) {
  const storage = durableRecord(
    "task-contract-attachment",
    userId,
    z.string().uuid().parse(taskId)
  );
  const read = () => {
    contractSession(generation);
    const raw = storage.read();
    return raw ? pending.parse(JSON.parse(raw)) : null;
  };
  return {
    read,
    save(value: PendingContract) {
      const next = pending.parse(value),
        previous = read();
      if (
        previous &&
        (previous.assetNodeId !== next.assetNodeId || (previous.attempted && !next.attempted))
      )
        throw Error("Another contract attachment is pending.");
      storage.write(JSON.stringify(next));
    },
    clear(assetNodeId: string, confirmed = false) {
      const previous = read();
      if (previous && (previous.assetNodeId !== assetNodeId || (previous.attempted && !confirmed)))
        throw Error("Retry the pending contract attachment before choosing another file.");
      storage.write("");
    },
  };
}
