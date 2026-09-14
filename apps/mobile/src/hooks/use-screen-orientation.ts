import { useFocusEffect, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core/usePreventRemove";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Dimensions, Platform, type LayoutChangeEvent } from "react-native";

import { windowMatchesTarget } from "./play-orientation";

const ORIENTATION_WAIT_TIMEOUT_MS = 1_200;
const POST_REMOUNT_SETTLE_MS = 320;
const ORIENTATION_POLL_MS = 50;

type OrientationTarget = "portrait" | "landscape";

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
  return windowMatchesTarget(width, height, target);
}

async function waitForWindow(target: OrientationTarget, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (windowMatches(target)) return true;
    if (Date.now() >= deadline) return windowMatches(target);
    await delay(ORIENTATION_POLL_MS);
  }
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
        await nextFrames(1);
        if (!isActive()) return;
        const rotated = await waitForWindow("landscape", ORIENTATION_WAIT_TIMEOUT_MS);
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
