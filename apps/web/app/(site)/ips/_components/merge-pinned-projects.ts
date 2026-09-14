/** Keep operator pins first within each video group, preserving server rank. */
export function mergePinnedProjects<T extends { id: string; trailer: string }>(
  ranked: T[],
  pinned: T[],
  hasNextPage: boolean
): T[] {
  const pinnedIds = new Set(pinned.map((project) => project.id));
  const unpinned = ranked.filter((project) => !pinnedIds.has(project.id));
  // Don't insert non-video pins ahead of videos on a not-yet-loaded page.
  const reachedNonVideo = !hasNextPage || ranked.some((project) => !project.trailer);
  return [
    ...pinned.filter((project) => project.trailer),
    ...unpinned.filter((project) => project.trailer),
    ...(reachedNonVideo ? pinned.filter((project) => !project.trailer) : []),
    ...unpinned.filter((project) => !project.trailer),
  ];
}
