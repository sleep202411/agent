import { useFocusEffect, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core/usePreventRemove";
import * as ScreenOrientation from "expo-screen-orientation";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Dimensions, Platform, type LayoutChangeEvent } from "react-native";

/**
 * Stack `orientation` is the mask iOS asks (play = landscape, everything else
 * portrait_up). It does not reliably call `requestGeometryUpdate` on this
 * Expo / Dev Client stack, so play still needs one `lockAsync` to actually
 * rotate. Never issue a second lock while that animation is running.
 */
const ORIENTATION_WAIT_TIMEOUT_MS = 1_200;
const POST_REMOUNT_SETTLE_MS = 320;
const ORIENTATION_POLL_MS = 50;

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

async function waitForWindow(target: OrientationTarget, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (windowMatches(target)) return true;
    if (Date.now() >= deadline) return windowMatches(target);
    await delay(ORIENTATION_POLL_MS);
  }
}

type OrientationRequest = {
  target: OrientationTarget;
  reason: string;
  cancelled: boolean;
};

let activeRequest: OrientationRequest | null = null;
let activeRun: Promise<boolean> | null = null;
let requestChain: Promise<unknown> = Promise.resolve();

function applyOrientation(target: OrientationTarget, reason: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(true);

  if (activeRequest && !activeRequest.cancelled && activeRequest.target === target && activeRun) {
    return activeRun;
  }

  if (activeRequest) activeRequest.cancelled = true;
  const request: OrientationRequest = { target, reason, cancelled: false };
  activeRequest = request;
  const run = requestChain.then(() => runOrientationRequest(request));
  activeRun = run;
  requestChain = run.catch(() => undefined);
  return run;
}

async function runOrientationRequest(request: OrientationRequest): Promise<boolean> {
  if (request.cancelled) return false;
  if (windowMatches(request.target)) return true;
  try {
    await ScreenOrientation.lockAsync(LOCK_FOR[request.target]);
  } catch (error: unknown) {
    console.warn(`[orientation] ${request.reason} failed`, error);
    return false;
  }
  if (request.cancelled) return false;
  const matched = await waitForWindow(request.target, ORIENTATION_WAIT_TIMEOUT_MS);
  if (matched) return true;
  if (request.target === "landscape") {
    console.warn(
      `[orientation] ${request.reason} slow; lock held — waiting on layout, not re-locking`
    );
    return true;
  }
  console.warn(
    `[orientation] ${request.reason} did not settle within ${ORIENTATION_WAIT_TIMEOUT_MS}ms`
  );
  return false;
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
 * Drive play rotation with one lockAsync after the landscape screen is focused.
 * The stack `orientation` option is still the mask Alert / other VCs see.
 */
export function usePlayScreenOrientation() {
  const navigation = useNavigation();
  const [awaitStageLandscape, setAwaitStageLandscape] = useState(Platform.OS !== "web");
  const [stageLandscape, setStageLandscape] = useState(false);
  const [exiting, setExiting] = useState(false);
  const exitInFlightRef = useRef(false);
  const rotatedRef = useRef(false);

  const onStageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const landscape = width > height;
    setStageLandscape(landscape);
    if (landscape) rotatedRef.current = true;
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let layoutFallback: ReturnType<typeof setTimeout> | undefined;
      const isActive = () => active && !exitInFlightRef.current;

      exitInFlightRef.current = false;
      rotatedRef.current = windowMatches("landscape");
      setExiting(false);
      exitCoverStore.set(false);

      void (async () => {
        if (Platform.OS === "web") {
          setAwaitStageLandscape(false);
          return;
        }
        // Two frames so RNScreens has applied this screen's landscape mask
        // before lockAsync asks iOS to rotate into it.
        await nextFrames(2);
        if (!isActive()) return;
        const rotated = await applyOrientation("landscape", "play landscape");
        if (rotated) rotatedRef.current = true;
        if (!isActive()) return;
        setAwaitStageLandscape(rotated);
        if (rotated) {
          layoutFallback = setTimeout(
            () => setAwaitStageLandscape(false),
            ORIENTATION_WAIT_TIMEOUT_MS
          );
        }
      })();

      return () => {
        active = false;
        if (layoutFallback) clearTimeout(layoutFallback);
        setAwaitStageLandscape(false);
      };
    }, [])
  );

  usePreventRemove(Platform.OS !== "web", ({ data }) => {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    setExiting(true);
    exitCoverStore.set(true);
    const rotated = rotatedRef.current || !windowMatches("portrait");

    void (async () => {
      try {
        navigation.setOptions({ animation: "none" });
        navigation.dispatch(data.action);
        await nextFrames(2);
        await applyOrientation("portrait", "play exit portrait");
        await waitForWindow("portrait", ORIENTATION_WAIT_TIMEOUT_MS);
        if (rotated) {
          remountTabs();
          await delay(POST_REMOUNT_SETTLE_MS);
        }
        await nextFrames(2);
      } finally {
        exitInFlightRef.current = false;
        exitCoverStore.set(false);
      }
    })();
  });

  const landscapeReady = Platform.OS === "web" || !awaitStageLandscape || stageLandscape;

  return { landscapeReady, exiting, onStageLayout };
}
