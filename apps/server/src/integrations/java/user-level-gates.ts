/**
 * Hard-coded Java `user_level.id` gates used by Nest.
 *
 * Keep aligned with deployed MySQL `user_level` rows. Currently:
 *   12 → free watch of all paid IP episodes (no community-point spend)
 *   13 → certified producer / public Crew recruitment (not Crew creation)
 */
export const FREE_IP_WATCH_LEVEL_ID = 12;
export const CERTIFIED_PRODUCER_LEVEL_ID = 13;
// Legacy name retained for IP-commerce entitlement callers.
export const CREW_CREATE_LEVEL_ID = CERTIFIED_PRODUCER_LEVEL_ID;

export function hasUserLevel(
  levelIds: readonly number[] | undefined,
  id: number,
): boolean {
  return Array.isArray(levelIds) && levelIds.includes(id);
}

export function hasFreeIpWatchPass(
  levelIds: readonly number[] | undefined,
): boolean {
  return hasUserLevel(levelIds, FREE_IP_WATCH_LEVEL_ID);
}

export function hasCrewCreatePass(
  levelIds: readonly number[] | undefined,
): boolean {
  return hasUserLevel(levelIds, CREW_CREATE_LEVEL_ID);
}

/** Parse Java `/user/query/user/info` top-level `level` array into numeric ids. */
export function parseJavaLevelIds(level: unknown): number[] {
  if (!Array.isArray(level)) return [];
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const row of level) {
    if (row === null || typeof row !== 'object') continue;
    const raw = (row as { id?: unknown }).id;
    const id =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' &&
            raw.trim() !== '' &&
            Number.isFinite(Number(raw))
          ? Number(raw)
          : NaN;
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
