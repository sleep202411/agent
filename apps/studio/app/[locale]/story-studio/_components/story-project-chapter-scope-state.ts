export function resolveStoryChapterId(input: {
  requestedChapterId: string | null;
  activeChapterId: string | null;
  chapterIds: ReadonlySet<string>;
  fallbackChapterId: string | null;
}): string | null {
  if (input.requestedChapterId && input.chapterIds.has(input.requestedChapterId)) {
    return input.requestedChapterId;
  }
  if (input.activeChapterId && input.chapterIds.has(input.activeChapterId)) {
    return input.activeChapterId;
  }
  return input.fallbackChapterId && input.chapterIds.has(input.fallbackChapterId)
    ? input.fallbackChapterId
    : null;
}

/**
 * One URL write per target chapter. A repeat call with the same pending href
 * must not navigate again: the selection update re-renders before the address
 * bar catches up, and a second replace cancels the open.
 */
export function nextChapterUrlSync(input: {
  pendingHref: string | null;
  pathname: string;
  search: string;
  requestedChapterId: string | null;
  resolvedChapterId: string | null;
}): { pendingHref: string | null; replaceHref: string | null } {
  if (!input.resolvedChapterId) {
    return { pendingHref: input.pendingHref, replaceHref: null };
  }
  if (input.requestedChapterId === input.resolvedChapterId) {
    return { pendingHref: null, replaceHref: null };
  }
  const next = new URLSearchParams(input.search);
  next.set("chapter", input.resolvedChapterId);
  const href = `${input.pathname}?${next.toString()}`;
  if (input.pendingHref === href) return { pendingHref: input.pendingHref, replaceHref: null };
  return { pendingHref: href, replaceHref: href };
}
