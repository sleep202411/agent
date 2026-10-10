import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import type { DurableRecord } from "./durable-record";
/** Persist exact commands before writes; only the matching receipt can clear them. */
export function pendingRequest<S extends z.ZodType<{ clientKey: string }>>(
  schema: S,
  generation: number,
  storage: DurableRecord
) {
  const record = z.object({ version: z.literal(1), intent: schema.nullable() });
  const current = () => {
    if (generation !== getAuthGeneration()) throw new Error("Message session expired.");
  };
  const read = () => {
    current();
    const raw = storage.read();
    return raw === null ? null : record.parse(JSON.parse(raw)).intent;
  };
  return {
    read,
    save: (intent: z.input<S>) => {
      current();
      const next = schema.parse(intent),
        previous = read();
      if (previous && JSON.stringify(previous) !== JSON.stringify(next))
        throw new Error("Another message is pending. Reopen this conversation before sending.");
      storage.write(JSON.stringify({ version: 1, intent: next }));
    },
    clear: (clientKey: string) => {
      current();
      const previous = read();
      if (previous && previous.clientKey !== clientKey)
        throw new Error("Another message is pending. Reopen this conversation before sending.");
      storage.write(JSON.stringify({ version: 1, intent: null }));
    },
  };
}
