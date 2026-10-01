export async function withTextPlayLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks)
    throw new Error("This browser cannot safely coordinate play sessions.");
  return navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("A text adventure action is already running in another window.");
    return action();
  });
}
