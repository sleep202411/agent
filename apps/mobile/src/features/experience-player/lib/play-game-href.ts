import type { Href } from "expo-router";

import type { ExperienceGameSummary } from "@/data/interactive-film-api";
import { toHref } from "@/lib/navigation";

/**
 * Open the interactive-film play route with list-card preview fields so the
 * cinematic start shell can paint once the black boot gate lifts (landscape +
 * manifest).
 */
export function playGameHref(
  game: Pick<ExperienceGameSummary, "gameId" | "title" | "subtitle" | "coverUrl">,
  options?: { chapterId?: string }
): Href {
  const params = new URLSearchParams();
  if (game.title.trim()) params.set("title", game.title.trim());
  if (game.subtitle?.trim()) params.set("subtitle", game.subtitle.trim());
  if (game.coverUrl?.trim()) params.set("coverUrl", game.coverUrl.trim());
  if (options?.chapterId?.trim()) params.set("chapter", options.chapterId.trim());
  const query = params.toString();
  return toHref(`/play/interactive-film/${game.gameId}${query ? `?${query}` : ""}`);
}

type PlayRouter = {
  push: (href: Href) => void;
};

/**
 * Enter play immediately. The play route shows a black gate, locks landscape
 * after the transition, loads the manifest, then reveals the start shell.
 */
export function navigateToPlay(
  router: PlayRouter,
  game: Pick<ExperienceGameSummary, "gameId" | "title" | "subtitle" | "coverUrl">,
  options?: { chapterId?: string }
): void {
  router.push(playGameHref(game, options));
}

type StoryPreviewNavOptions = {
  chapterId?: string;
  /** List/workspace title so the start shell can paint before working-preview. */
  title?: string;
  coverUrl?: string;
};

/** H5 `/story-studio/projects/:id/playtest?chapter=` — private working-preview. */
export function playStoryPreviewHref(projectId: string, options?: StoryPreviewNavOptions): Href {
  const params = new URLSearchParams();
  if (options?.chapterId?.trim()) params.set("chapter", options.chapterId.trim());
  if (options?.title?.trim()) params.set("title", options.title.trim());
  if (options?.coverUrl?.trim()) params.set("coverUrl", options.coverUrl.trim());
  const query = params.toString();
  return toHref(`/play/story-preview/${projectId}${query ? `?${query}` : ""}`);
}

export function navigateToStoryPreview(
  router: PlayRouter,
  projectId: string,
  options?: StoryPreviewNavOptions
): void {
  router.push(playStoryPreviewHref(projectId, options));
}
