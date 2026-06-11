/**
 * Small deterministic string hash. Used for stable visual variety (poster
 * tints) and seeded mock values (room codes) — never for anything secure.
 */
export function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Pick a deterministic element from a list, seeded by a string key. */
export function pickBy<T>(items: readonly T[], key: string): T {
  return items[hashString(key) % items.length];
}
