const running = new Set<string>();
export async function withTextPlayLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (running.has(key)) throw new Error("A text adventure action is already running.");
  running.add(key);
  try {
    return await action();
  } finally {
    running.delete(key);
  }
}
