export async function withTextCreationLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks)
    throw new Error("This browser cannot safely coordinate creation.");
  return navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Text adventure creation is already running in another window.");
    return action();
  });
}
