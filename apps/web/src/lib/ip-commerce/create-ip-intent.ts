/** Recovery metadata only: no draft text, credentials or profile data is persisted. */
export interface IpCreationIntent {
  key: string;
  storageKey: string;
}
const PREFIX = "fizzdragon:ip-create:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}

export async function recoverIpCreationIntent(
  userId: string,
  input: unknown
): Promise<IpCreationIntent> {
  const bytes = new TextEncoder().encode(JSON.stringify([userId, canonical(input)]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const storageKey =
    PREFIX +
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  // There is no await between reading and writing: concurrent submissions in this
  // tab resolve to the same identity before either sends its network request.
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing && UUID.test(existing)) return { key: existing, storageKey };
    const key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
    return { key, storageKey };
  } catch {
    // Storage-disabled browsers retain the hook's existing in-memory retry safety.
    return { key: crypto.randomUUID(), storageKey };
  }
}

export function completeIpCreationIntent(intent: IpCreationIntent) {
  try {
    if (sessionStorage.getItem(intent.storageKey) === intent.key)
      sessionStorage.removeItem(intent.storageKey);
  } catch {
    /* A successful server response remains successful if browser storage is unavailable. */
  }
}
