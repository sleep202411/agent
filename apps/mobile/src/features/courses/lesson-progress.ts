import type { VideoPlayer } from "expo-video";
import { getStoredString, setStoredString } from "@/lib/persistent-storage";

export type LessonProgress = { currentTime: number; duration: number };
const writes = new Map<string, Promise<void>>();
const encode = (value: string) =>
  Array.from(value, (char) => char.codePointAt(0)!.toString(16)).join("_");
export function lessonProgressKey(
  account: string | null,
  region: string,
  course: number,
  lesson: number
) {
  return `course-progress.v1.${account === null ? "guest" : `user-${encode(account)}`}.${encode(region)}.${course}.${lesson}`;
}
function valid(value: unknown): value is LessonProgress {
  if (!value || typeof value !== "object") return false;
  const progress = value as LessonProgress;
  return (
    Number.isFinite(progress.currentTime) &&
    progress.currentTime >= 0 &&
    Number.isFinite(progress.duration) &&
    progress.duration > 0 &&
    progress.currentTime <= progress.duration
  );
}
export async function readLessonProgress(key: string): Promise<LessonProgress | null> {
  try {
    await writes.get(key);
    const raw = await getStoredString(key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}
export function saveLessonProgress(key: string, value: LessonProgress): Promise<void> {
  if (!valid(value)) return Promise.resolve();
  const serialized = JSON.stringify(value);
  // Navigation can remount a lesson before its final write completes. Serialize
  // writes per lesson so an older async operation cannot replace newer progress.
  const write = (writes.get(key) ?? Promise.resolve())
    .then(() => setStoredString(key, serialized))
    .catch(() => {
      /* Local preferences must not prevent playback. */
    });
  writes.set(key, write);
  void write.then(() => {
    if (writes.get(key) === write) writes.delete(key);
  });
  return write;
}

export function trackLessonProgress(
  player: VideoPlayer,
  key: string,
  initial: LessonProgress | null,
  onSaved?: () => Promise<void>
) {
  let restored = false;
  let latest: LessonProgress | null = null;
  let lastSavedAt = 0;
  let active = true;
  const restore = (duration: number) => {
    if (!active || restored || !Number.isFinite(duration) || duration <= 0) return;
    if (initial) player.currentTime = Math.min(initial.currentTime, Math.max(duration - 1, 0));
    restored = true;
  };
  const sample = () => {
    if (!active || !restored || player.status !== "readyToPlay") return;
    const value = { currentTime: player.currentTime, duration: player.duration };
    if (valid(value)) latest = value;
  };
  const flush = () => {
    if (latest)
      void saveLessonProgress(key, latest)
        .then(() => onSaved?.())
        .catch(() => {});
  };
  const subscriptions = [
    player.addListener("sourceLoad", ({ duration }) => restore(duration)),
    player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") restore(player.duration);
    }),
    player.addListener("timeUpdate", () => {
      if (!active) return;
      sample();
      const now = Date.now();
      if (latest && now - lastSavedAt >= 5000) {
        lastSavedAt = now;
        flush();
      }
    }),
    player.addListener("playingChange", ({ isPlaying }) => {
      if (!active || isPlaying) return;
      sample();
      flush();
    }),
  ];
  player.timeUpdateEventInterval = 1;
  if (player.status === "readyToPlay") restore(player.duration);
  return () => {
    try {
      sample();
    } catch {
      /* The native player may already be released. */
    }
    active = false;
    subscriptions.forEach((subscription) => subscription.remove());
    flush();
  };
}
