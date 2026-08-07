import { useFocusEffect } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { useCallback, useState } from "react";
import { Platform } from "react-native";

/** Only used when the first lock did not stick (enter or leave). */
const ORIENTATION_RETRY_MS = 200;

async function lockOrientation(
  lock: ScreenOrientation.OrientationLock,
  reason: string
): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await ScreenOrientation.lockAsync(lock);
  } catch (error: unknown) {
    console.warn(`[orientation] ${reason} failed`, error);
  }
}

async function isPortraitUp(): Promise<boolean> {
  try {
    return (
      (await ScreenOrientation.getOrientationAsync()) === ScreenOrientation.Orientation.PORTRAIT_UP
    );
  } catch {
    return false;
  }
}

/**
 * Serial orientation lock queue with epoch invalidation.
 * Prevents an in-flight landscape lock from completing after a later portrait
 * restore (the "stuck landscape after leaving play" race).
 */
let lockEpoch = 0;
let lockChain: Promise<void> = Promise.resolve();

function enqueueOrientationLock(
  lock: ScreenOrientation.OrientationLock,
  reason: string
): Promise<void> {
  const epoch = ++lockEpoch;
  const run = lockChain.then(async () => {
    if (epoch !== lockEpoch) return;
    await lockOrientation(lock, reason);
  });
  // Keep the chain alive even if one lock fails.
  lockChain = run.catch(() => undefined);
  return run;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bumped to cancel an in-flight restorePortrait (exit → quick re-enter play). */
let restoreGeneration = 0;

function cancelPendingPortraitRestore() {
  restoreGeneration += 1;
}

/**
 * Restore portrait; retry once only if the first lock did not stick (iOS pop
 * race). Abortable so a quick re-enter to play cannot be overwritten by the
 * delayed retry.
 */
async function restorePortrait(reason: string): Promise<void> {
  const generation = ++restoreGeneration;
  await enqueueOrientationLock(ScreenOrientation.OrientationLock.PORTRAIT_UP, reason);
  if (generation !== restoreGeneration) return;

  if (await isPortraitUp()) return;
  if (generation !== restoreGeneration) return;

  await delay(ORIENTATION_RETRY_MS);
  if (generation !== restoreGeneration) return;
  await enqueueOrientationLock(ScreenOrientation.OrientationLock.PORTRAIT_UP, `${reason} retry`);
}

/**
 * Lock landscape as soon as play focuses. No pre-delay — Stack already
 * declares landscape. Retry once only if still portrait after the first lock.
 */
async function lockPlayLandscape(isActive: () => boolean): Promise<void> {
  await enqueueOrientationLock(ScreenOrientation.OrientationLock.LANDSCAPE, "play lock landscape");
  if (!isActive()) return;

  if (!(await isPortraitUp())) return;
  if (!isActive()) return;

  await delay(ORIENTATION_RETRY_MS);
  if (!isActive()) return;
  await enqueueOrientationLock(
    ScreenOrientation.OrientationLock.LANDSCAPE,
    "play lock landscape retry"
  );
}

/**
 * Play-route orientation: black boot gate waits on `landscapeReady`, then
 * detail/manifest fetch may start. Cleanup restores portrait on leave.
 */
export function usePlayScreenOrientation() {
  const [landscapeReady, setLandscapeReady] = useState(Platform.OS === "web");

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const isActive = () => active;

      cancelPendingPortraitRestore();
      setLandscapeReady(Platform.OS === "web");

      void (async () => {
        if (Platform.OS === "web") return;
        await lockPlayLandscape(isActive);
        if (active) setLandscapeReady(true);
      })();

      return () => {
        active = false;
        setLandscapeReady(false);
        void restorePortrait("play restore portrait");
      };
    }, [])
  );

  return { landscapeReady };
}

/** App shell default — keep non-play surfaces in portrait. */
export async function lockAppPortrait(): Promise<void> {
  cancelPendingPortraitRestore();
  await enqueueOrientationLock(
    ScreenOrientation.OrientationLock.PORTRAIT_UP,
    "initial portrait lock"
  );
}
