export function clientRequestKey() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
