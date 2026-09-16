import { requestEnvelope } from "./users/shared";

/** Bound fetching and body consumption together, without retrying authentication. */
export async function adminAuthRequest<T>(
  path: string,
  body: Record<string, unknown>,
  controller: AbortController
): Promise<T> {
  controller.signal.throwIfAborted();
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  const timer = setTimeout(
    () => controller.abort(new Error("Authentication timed out. Please retry.")),
    30_000
  );
  try {
    return await Promise.race([
      requestEnvelope<T>(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }),
      cancelled,
    ]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
