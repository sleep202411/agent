/**
 * Lift IP Plaza "For you" discovery placements to the front of the TV
 * catalog, keeping the admin sortOrder and dropping duplicates from the
 * ranked list.
 */
export function prioritizeForYou<T extends { id: string }>(ranked: T[], forYou: T[]): T[] {
  if (forYou.length === 0) return ranked;
  const seen = new Set<string>();
  const head: T[] = [];
  for (const item of forYou) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    head.push(item);
  }
  return [...head, ...ranked.filter((item) => !seen.has(item.id))];
}
