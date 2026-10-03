import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { claimCreditCampaign, redeemCreditVoucher, voucherCodeSchema } from "./credit-rewards-api";
const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("campaign"), id: z.string().uuid() }),
  z.object({ kind: z.literal("voucher"), code: voucherCodeSchema }),
]);
export type CreditRewardCommand = z.infer<typeof commandSchema>;
/** Checkpoint before dispatch: a captured server claim may still need its grant repaired. */
export function creditRewardCommands(
  userId: string,
  generation: number,
  storage: DurableRecord = durableRecord("credit-rewards", userId, "personal")
) {
  let busy = false;
  const current = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (generation !== getAuthGeneration()) throw Error("Credit rewards session expired.");
  };
  const read = () => {
    current();
    const raw = storage.read();
    return raw ? commandSchema.nullable().parse(JSON.parse(raw)) : null;
  };
  const clear = () => {
    current();
    if (busy) throw Error("Wait for the credit reward request to finish.");
    storage.write("null");
  };
  return {
    read,
    clear,
    async submit(input: CreditRewardCommand, signal: AbortSignal) {
      current(signal);
      if (busy) throw Error("A credit reward request is already running.");
      const command = commandSchema.parse(input),
        pending = read();
      if (pending && JSON.stringify(pending) !== JSON.stringify(command))
        throw Error("Resolve the pending credit reward first.");
      storage.write(JSON.stringify(command));
      busy = true;
      try {
        const result =
          command.kind === "campaign"
            ? await claimCreditCampaign(command.id, generation, signal)
            : await redeemCreditVoucher(command.code, generation, signal);
        current(signal);
        storage.write("null");
        return result;
      } finally {
        busy = false;
      }
    },
  };
}
