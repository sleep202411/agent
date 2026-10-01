const running = new Set<string>();
export async function withReviewWorkflowLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (running.has(key)) throw new Error("This review is already running");
  running.add(key);
  try {
    return await action();
  } finally {
    running.delete(key);
  }
}
