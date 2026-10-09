import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core/usePreventRemove";
import * as ScreenOrientation from "expo-screen-orientation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";

const ORIENTATION_WAIT_TIMEOUT_MS = 1_600;
/** Already-matching reading can be a frame mid-turn. Confirm it holds. */
const CONFIRM_ALREADY_MS = 700;
const POST_REMOUNT_SETTLE_MS = 320;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let orientationChain: Promise<void> = Promise.resolve();

function enqueueLock(lock: ScreenOrientation.OrientationLock): Promise<void> {
  const next = orientationChain.then(() => ScreenOrientation.lockAsync(lock));
  orientationChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/** Keep the rest of the app portrait. Do not unlock — `orientation: "default"` would allow rotation. */
export function lockAppPortrait(): void {
  if (Platform.OS === "web") return;
  void enqueueLock(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
}

function isLandscape(orientation: ScreenOrientation.Orientation): boolean {
  return (
    orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
    orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT
  );
}

function isPortrait(orientation: ScreenOrientation.Orientation): boolean {
  return (
    orientation === ScreenOrientation.Orientation.PORTRAIT_UP ||
    orientation === ScreenOrientation.Orientation.PORTRAIT_DOWN
  );
}

/**
 * `lockAsync` resolves when the request is sent, not when the turn finishes.
 * The listener fires from the transition completion. A matching reading that
 * arrives first is only accepted if it is still true after a short confirm,
 * so an in-flight turn the other way cannot slip through.
 */
function waitForApplied(
  match: (orientation: ScreenOrientation.Orientation) => boolean,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let confirmTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (confirmTimer) clearTimeout(confirmTimer);
      clearTimeout(timeoutTimer);
      subscription.remove();
      resolve();
    };

    const subscription = ScreenOrientation.addOrientationChangeListener((event) => {
      if (confirmTimer) {
        clearTimeout(confirmTimer);
        confirmTimer = undefined;
      }
      if (match(event.orientationInfo.orientation)) finish();
    });

    const timeoutTimer = setTimeout(() => finish(), timeoutMs);

    void ScreenOrientation.getOrientationAsync().then((orientation) => {
      if (settled || !match(orientation)) return;
      confirmTimer = setTimeout(() => {
        void ScreenOrientation.getOrientationAsync().then((again) => {
          if (!settled && match(again)) finish();
        });
      }, CONFIRM_ALREADY_MS);
    });
  });
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

const exitCoverStore = createStore(false);

export const subscribePlayOrientationExitCover = exitCoverStore.subscribe;
export const getPlayOrientationExitCoverSnapshot = exitCoverStore.get;

const tabsRemountStore = createStore(0);

export function useTabsRemountKey(): number {
  return useSyncExternalStore(tabsRemountStore.subscribe, tabsRemountStore.get, () => 0);
}

function remountTabs() {
  tabsRemountStore.set(tabsRemountStore.get() + 1);
}

/**
 * Play screen locks landscape for as long as it is open. Leave locks portrait
 * and waits until that turn has finished before popping, so the tab shell and
 * a later modal do not inherit an in-flight landscape.
 */
export function usePlayScreenOrientation() {
  const navigation = useNavigation();
  const [landscapeReady, setLandscapeReady] = useState(Platform.OS === "web");
  const [exiting, setExiting] = useState(false);
  const exitInFlightRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;

    void (async () => {
      try {
        await enqueueLock(ScreenOrientation.OrientationLock.LANDSCAPE);
        if (cancelled || exitInFlightRef.current) return;
        await waitForApplied(isLandscape, ORIENTATION_WAIT_TIMEOUT_MS);
        if (cancelled || exitInFlightRef.current) return;
        setLandscapeReady(true);
      } catch {
        if (!cancelled && !exitInFlightRef.current) setLandscapeReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  usePreventRemove(Platform.OS !== "web", ({ data }) => {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    setExiting(true);
    setLandscapeReady(false);
    exitCoverStore.set(true);

    void (async () => {
      let popped = false;
      try {
        await enqueueLock(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        await waitForApplied(isPortrait, ORIENTATION_WAIT_TIMEOUT_MS);
        navigation.dispatch(data.action);
        popped = true;
        await waitForApplied(isPortrait, ORIENTATION_WAIT_TIMEOUT_MS);
        remountTabs();
        await delay(POST_REMOUNT_SETTLE_MS);
      } catch {
        if (!popped) navigation.dispatch(data.action);
        remountTabs();
      } finally {
        exitInFlightRef.current = false;
        exitCoverStore.set(false);
      }
    })();
  });

  return { landscapeReady, exiting };
}
