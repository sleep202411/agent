/** Collect a complete inventory; never report a truncated or cyclic walk as complete. */
export async function collectIpPages<T extends { id: string }>(
  read: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
  signal: AbortSignal
): Promise<{ items: T[] }> {
  const items: T[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 200; page++) {
    signal.throwIfAborted();
    const result = await read(cursor);
    signal.throwIfAborted();
    for (const item of result.items) {
      if (!ids.has(item.id)) {
        ids.add(item.id);
        items.push(item);
      }
    }
    if (!result.nextCursor) return { items };
    if (cursors.has(result.nextCursor)) throw new Error("IP pagination repeated a cursor.");
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error("IP pagination exceeded the page limit before completing.");
}
