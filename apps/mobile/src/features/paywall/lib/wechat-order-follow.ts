import { getAuthGeneration } from "@/auth/auth-store";
import { capturePaymentSession } from "./payment-session";
import { getBillingOrder, isOrderDead, isOrderFulfilled } from "./billing-api";

const POLL_MS = 2500;
const MAX_ATTEMPTS = 8;

export type WechatFollowResult = "fulfilled" | "dead" | "timeout" | "aborted";

const inFlight = new Map<string, Promise<WechatFollowResult>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keep reading a WeChat Native order until Nest reconciles it.
 * Survives leaving the paywall — only aborts on account change.
 * Concurrent follows for the same orderId share one poll.
 */
export function followWechatOrderUntilSettled(orderId: string): Promise<WechatFollowResult> {
  const key = `${getAuthGeneration()}:${orderId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const assertAccount = capturePaymentSession();
  const run = (async (): Promise<WechatFollowResult> => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        assertAccount();
      } catch {
        return "aborted";
      }
      try {
        const order = await getBillingOrder(orderId);
        assertAccount();
        if (isOrderFulfilled(order.status)) return "fulfilled";
        if (isOrderDead(order.status)) return "dead";
      } catch {
        try {
          assertAccount();
        } catch {
          return "aborted";
        }
        // Transient — try again for the same account.
      }
      if (attempt < MAX_ATTEMPTS - 1) await sleep(POLL_MS);
    }
    return "timeout";
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, run);
  return run;
}
