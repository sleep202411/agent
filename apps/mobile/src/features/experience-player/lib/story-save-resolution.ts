import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";

import { fetchLatestSave, getStorySaveChannel, reloadStorySaveGame } from "./story-save-channel";
import {
  validateExperienceSaveCheckpoint,
  type ExperienceSaveCheckpoint,
} from "./experience-save-checkpoint";

export type StorySaveResolution =
  | { phase: "ready"; checkpoint: ExperienceSaveCheckpoint | null }
  | { phase: "redirecting"; chapterId: string }
  | { phase: "incompatible"; savedChapterId: string; reason: "chapter" | "state" };

export interface StorySaveResolutionInput {
  accountId: string | null;
  runtime: ExperienceRuntimeManifest;
  chapterId: string;
  availableChapterIds: readonly string[];
  /** Whether the viewer explicitly selected a chapter, before URL canonicalization. */
  explicitChapter: boolean;
  reload?: boolean;
  signal?: AbortSignal;
}

/** Resolve before mounting playback: failed reads must never become empty saves. */
export async function resolveStorySave({
  accountId,
  runtime,
  chapterId,
  availableChapterIds,
  explicitChapter,
  reload = false,
  signal,
}: StorySaveResolutionInput): Promise<StorySaveResolution> {
  signal?.throwIfAborted();
  if (!accountId) return { phase: "ready", checkpoint: null };
  const channel = getStorySaveChannel(accountId, runtime.gameId, chapterId);
  const current = () => {
    signal?.throwIfAborted();
    if (!channel.ownsSession()) throw new DOMException("Save session changed", "AbortError");
  };
  if (reload) {
    await reloadStorySaveGame(accountId, runtime.gameId, signal);
    current();
  }
  // Latest is a navigation pointer. Read the actual chapter slot as well to
  // obtain its current revision and full journey (including cleared tombstones).
  const latest = explicitChapter ? null : await fetchLatestSave(accountId, runtime.gameId, signal);
  current();
  if (latest && latest.chapterId !== chapterId) {
    if (!availableChapterIds.includes(latest.chapterId)) {
      return { phase: "incompatible", savedChapterId: latest.chapterId, reason: "chapter" };
    }
    return { phase: "redirecting", chapterId: latest.chapterId };
  }
  const slot = await channel.read(signal);
  current();
  // A same-session interrupted write wins only after read() has checked its
  // revision. A competing device therefore produces a conflict, not overwrite.
  const candidate = channel.getPending() ?? slot.save;
  if (!candidate) return { phase: "ready", checkpoint: null };
  try {
    const checkpoint = validateExperienceSaveCheckpoint(runtime, candidate);
    return { phase: "ready", checkpoint };
  } catch {
    return { phase: "incompatible", savedChapterId: chapterId, reason: "state" };
  }
}

/** Explicit restart clears only requested slots, retaining revision tombstones. */
export async function clearStorySaveSlots({
  accountId,
  gameId,
  chapterIds,
  signal,
}: {
  accountId: string;
  gameId: string;
  chapterIds: readonly string[];
  signal?: AbortSignal;
}): Promise<void> {
  signal?.throwIfAborted();
  // Capture all channels in the original account scope before yielding. A late
  // continuation cannot recreate that account's scope after a login change.
  const channels = [...new Set(chapterIds)].map((chapterId) =>
    getStorySaveChannel(accountId, gameId, chapterId)
  );
  for (const channel of channels) {
    signal?.throwIfAborted();
    if (!channel.ownsSession()) throw new DOMException("Save session changed", "AbortError");
    await channel.read(signal);
    signal?.throwIfAborted();
    if (!channel.ownsSession()) throw new DOMException("Save session changed", "AbortError");
    await channel.clear();
  }
}
