import { getAuthGeneration } from "@/auth/auth-store";

/** A preflight may finish after logout or account replacement. */
export function capturePaymentSession(): () => void {
  const generation = getAuthGeneration();
  return () => {
    if (getAuthGeneration() !== generation) {
      throw new Error("[paywall] Account changed before payment started. Please try again.");
    }
  };
}
