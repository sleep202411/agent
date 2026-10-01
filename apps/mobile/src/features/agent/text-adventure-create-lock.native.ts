const running = new Set<string>();
export async function withTextCreationLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (running.has(key)) throw new Error("Text adventure creation is already running.");
  running.add(key);
  try {
    return await action();
  } finally {
    running.delete(key);
  }
}
