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
  const existing = inFlight.get(orderId);
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
        if (isOrderFulfilled(order.status)) return "fulfilled";
        if (isOrderDead(order.status)) return "dead";
      } catch {
        // Transient — try again.
      }
      if (attempt < MAX_ATTEMPTS - 1) await sleep(POLL_MS);
    }
    return "timeout";
  })().finally(() => {
    inFlight.delete(orderId);
  });

  inFlight.set(orderId, run);
  return run;
}
