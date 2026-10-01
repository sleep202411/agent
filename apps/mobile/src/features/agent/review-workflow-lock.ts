export async function withReviewWorkflowLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks)
    throw new Error("This browser cannot safely coordinate review creation");
  return navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("This review is already running in another window");
    return action();
  });
}
