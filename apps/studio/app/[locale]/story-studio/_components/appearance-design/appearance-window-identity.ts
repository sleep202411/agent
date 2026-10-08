const STORAGE_KEY = "fizzdragon.design-window.v1";
const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

/** Session storage isolates editor windows while retaining the session across reloads. */
export function appearanceWindowIdentity(storage: Pick<Storage, "getItem" | "setItem">): string {
  const fresh = () => crypto.randomUUID();
  let identity: string;
  try {
    const saved = storage.getItem(STORAGE_KEY);
    identity = saved && UUID.test(saved) ? saved : fresh();
  } catch {
    return fresh();
  }
  try {
    storage.setItem(STORAGE_KEY, identity);
  } catch {
    // The caller's ref retains this identity when browser storage is unavailable.
  }
  return identity;
}
