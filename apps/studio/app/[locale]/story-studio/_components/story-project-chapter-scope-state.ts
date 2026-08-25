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
