import { type DurableRecord } from "@/lib/durable-record-key";
import {
  assertWithdrawalSession,
  withdrawalCommand,
  type WithdrawalCommand,
} from "./withdrawal-api";
export function withdrawalPending(generation: number, storage: DurableRecord) {
  const read = () => {
    assertWithdrawalSession(generation);
    const raw = storage.read();
    return raw ? withdrawalCommand.parse(JSON.parse(raw)) : null;
  };
  return {
    read,
    save: (input: WithdrawalCommand) => {
      const next = withdrawalCommand.parse(input),
        previous = read();
      if (previous && JSON.stringify(previous) !== JSON.stringify(next))
        throw Error("Another withdrawal is pending. Retry its original request first.");
      storage.write(JSON.stringify(next));
    },
    clear: (requestId: string) => {
      const previous = read();
      if (previous && previous.requestId !== requestId)
        throw Error("Another withdrawal is pending.");
      storage.write("");
    },
  };
}
