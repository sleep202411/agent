import { api } from "@/src/lib/api/api-client";

/**
 * Client for /aurora/story-saves — interactive-film play saves (存档).
 * One "current run" slot per (user, game, chapter); `chapterId` is "" for
 * single-chapter works. Auth rides the satoken cookie; failures are
 * non-fatal for playback (the caller decides whether to surface them).
 */

export interface StorySave {
  gameId: string;
  chapterId: string;
  contentVersion: string;
  state: unknown;
  events: unknown[];
  updatedAt: string;
}

export interface SavePayload {
  contentVersion: string;
  state: unknown;
  events: unknown[];
}

function slotPath(gameId: string, chapterId: string): string {
  const base = `/aurora/story-saves/${encodeURIComponent(gameId)}/save`;
  return chapterId ? `${base}?chapterId=${encodeURIComponent(chapterId)}` : base;
}

/** Most recently played chapter's save — the "continue playing" pointer. */
export async function fetchLatestSave(gameId: string): Promise<StorySave | null> {
  const save = await api.get<StorySave | null>(
    `/aurora/story-saves/${encodeURIComponent(gameId)}/latest`,
    { cache: "no-store" }
  );
  return save ?? null;
}

export async function fetchChapterSave(
  gameId: string,
  chapterId: string
): Promise<StorySave | null> {
  const save = await api.get<StorySave | null>(slotPath(gameId, chapterId), {
    cache: "no-store",
  });
  return save ?? null;
}

export async function putChapterSave(
  gameId: string,
  chapterId: string,
  payload: SavePayload
): Promise<void> {
  await api.put(slotPath(gameId, chapterId), { data: payload });
}

export async function clearChapterSave(gameId: string, chapterId: string): Promise<void> {
  await api.delete(slotPath(gameId, chapterId));
}

/** Last-resort flush when the page is being torn down (keepalive survives it). */
export function putChapterSaveBeacon(
  gameId: string,
  chapterId: string,
  payload: SavePayload
): void {
  try {
    void fetch(slotPath(gameId, chapterId), {
      method: "PUT",
      keepalive: true,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* The page is going away — nothing more we can do. */
  }
}
