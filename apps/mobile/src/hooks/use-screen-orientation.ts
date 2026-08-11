import { useFocusEffect, useNavigation } from "expo-router";
// Not re-exported from the expo-router root; native-stack needs this hook
// instead of a raw `beforeRemove` listener to hold the pop.
import { usePreventRemove } from "expo-router/build/react-navigation/core/usePreventRemove";
import * as ScreenOrientation from "expo-screen-orientation";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Dimensions, Platform } from "react-native";

/**
 * Grace window for the rotation iOS is already running. `getOrientationAsync`
 * only reports the new value once the transition completes, so a lock that is
 * working still looks unapplied for a few hundred ms.
 */
const ORIENTATION_SETTLE_MS = 700;
/** Fallback so a gate cannot hang when rotation is disabled (Simulator). */
const ORIENTATION_WAIT_TIMEOUT_MS = 1_200;
/**
 * NativeTabs re-layouts after its remount, which Dimensions cannot report —
 * the window is already portrait before the pop.
 */
const POST_REMOUNT_SETTLE_MS = 320;

type OrientationTarget = "portrait" | "landscape";

const LOCK_FOR: Record<OrientationTarget, ScreenOrientation.OrientationLock> = {
  portrait: ScreenOrientation.OrientationLock.PORTRAIT_UP,
  landscape: ScreenOrientation.OrientationLock.LANDSCAPE,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

function windowMatches(target: OrientationTarget): boolean {
  const { width, height } = Dimensions.get("window");
  return target === "portrait" ? height >= width : width > height;
}

async function orientationMatches(target: OrientationTarget): Promise<boolean> {
  if (windowMatches(target)) return true;
  try {
    const current = await ScreenOrientation.getOrientationAsync();
    return target === "portrait"
      ? current === ScreenOrientation.Orientation.PORTRAIT_UP ||
          current === ScreenOrientation.Orientation.PORTRAIT_DOWN
      : current === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
          current === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
  } catch {
    return false;
  }
}

/**
 * Serial lock queue with epoch invalidation — drops a stale landscape lock when
 * a newer portrait restore is already queued (and the reverse).
 */
let lockEpoch = 0;
let lockChain: Promise<void> = Promise.resolve();

function enqueueOrientationLock(target: OrientationTarget, reason: string): Promise<void> {
  const epoch = ++lockEpoch;
  const run = lockChain.then(async () => {
    if (epoch !== lockEpoch) return;
    try {
      await ScreenOrientation.lockAsync(LOCK_FOR[target]);
    } catch (error: unknown) {
      console.warn(`[orientation] ${reason} failed`, error);
    }
  });
  lockChain = run.catch(() => undefined);
  return run;
}

async function waitForOrientation(target: OrientationTarget, timeoutMs: number): Promise<void> {
  if (await orientationMatches(target)) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      dimensionSub.remove();
      orientationSub.remove();
      clearInterval(poll);
      clearTimeout(timer);
      resolve();
    };

    const tick = () => {
      void orientationMatches(target).then((ok) => {
        if (ok) finish();
      });
    };

    const dimensionSub = Dimensions.addEventListener("change", tick);
    const orientationSub = ScreenOrientation.addOrientationChangeListener(tick);
    const poll = setInterval(tick, 50);
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * Lock, wait for the rotation, retry once if it never happened. Resolves to
 * whether the rotation actually landed.
 *
 * The wait before the retry is load-bearing: iOS applies the lock through
 * `requestGeometryUpdate` plus a device-orientation nudge, and re-issuing that
 * while the animation is still running snaps the window back through the old
 * orientation first — the landscape → portrait → landscape bounce.
 */
async function applyOrientation(
  target: OrientationTarget,
  reason: string,
  isActive: () => boolean = () => true
): Promise<boolean> {
  if (Platform.OS === "web") return true;

  await enqueueOrientationLock(target, reason);
  if (!isActive()) return false;

  await waitForOrientation(target, ORIENTATION_SETTLE_MS);
  if (!isActive()) return false;
  if (await orientationMatches(target)) return true;

  await enqueueOrientationLock(target, `${reason} retry`);
  if (!isActive()) return false;

  await waitForOrientation(target, ORIENTATION_WAIT_TIMEOUT_MS);
  return orientationMatches(target);
}

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => value,
    set: (next: T) => {
      if (Object.is(value, next)) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Hosted in the root layout so it outlives the play route during the pop. */
const exitCoverStore = createStore(false);

export const subscribePlayOrientationExitCover = exitCoverStore.subscribe;
export const getPlayOrientationExitCoverSnapshot = exitCoverStore.get;

/**
 * NativeTabs keeps the landscape layout it was mounted with, and native-stack
 * has no option to detach inactive screens — so remount the tab tree instead.
 */
const tabsRemountStore = createStore(0);

export function useTabsRemountKey(): number {
  return useSyncExternalStore(tabsRemountStore.subscribe, tabsRemountStore.get, () => 0);
}

function remountTabs() {
  tabsRemountStore.set(tabsRemountStore.get() + 1);
}

/**
 * Play orientation, driven only by `expo-screen-orientation`. Stack
 * `orientation` is deliberately unused: with react-native-screens / Dev Client
 * on iOS it updates the allowed mask without reliably rotating.
 */
export function usePlayScreenOrientation() {
  const navigation = useNavigation();
  const [landscapeReady, setLandscapeReady] = useState(Platform.OS === "web");
  const [exiting, setExiting] = useState(false);
  const allowLeaveRef = useRef(Platform.OS === "web");
  const exitInFlightRef = useRef(false);
  /** Only a real rotation leaves the tabs below with a stale layout. */
  const rotatedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // An exit cancels the landscape attempt too — otherwise its retry would
      // re-lock landscape on top of the portrait restore.
      const isActive = () => active && !exitInFlightRef.current;

      allowLeaveRef.current = Platform.OS === "web";
      exitInFlightRef.current = false;
      rotatedRef.current = false;
      setExiting(false);
      setLandscapeReady(Platform.OS === "web");
      exitCoverStore.set(false);

      void (async () => {
        if (Platform.OS === "web") return;
        if (await applyOrientation("landscape", "play landscape", isActive)) {
          rotatedRef.current = true;
        }
        if (isActive()) setLandscapeReady(true);
      })();

      return () => {
        active = false;
        setLandscapeReady(false);
        // Safety net for leaves that bypass prevent-remove (replace / reset).
        if (allowLeaveRef.current) return;
        const shouldRemount = rotatedRef.current;
        void applyOrientation("portrait", "play portrait (blur)").then(() => {
          if (shouldRemount) remountTabs();
        });
      };
    }, [])
  );

  usePreventRemove(Platform.OS !== "web", ({ data }) => {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    setExiting(true);
    exitCoverStore.set(true);
    // Read before the restore: leaving mid-rotation still leaves stale tabs.
    const rotated = rotatedRef.current || !windowMatches("portrait");

    void (async () => {
      try {
        await applyOrientation("portrait", "play exit portrait");
        navigation.setOptions({ animation: "none" });
        allowLeaveRef.current = true;
        navigation.dispatch(data.action);

        if (rotated) {
          remountTabs();
          await delay(POST_REMOUNT_SETTLE_MS);
        }
        await nextFrames(2);
      } finally {
        allowLeaveRef.current = true;
        exitInFlightRef.current = false;
        exitCoverStore.set(false);
      }
    })();
  });

  return { landscapeReady, exiting };
}

/** App shell default — portrait everywhere except play. */
export async function lockAppPortrait(): Promise<void> {
  await enqueueOrientationLock("portrait", "initial portrait lock");
}
