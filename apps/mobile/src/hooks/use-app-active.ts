import { useIsFocused } from "expo-router";
import { useEffect, useEffectEvent, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { NativeEventSubscription } from "react-native";

/**
 * One native AppState subscription for the whole app, fanned out to listeners.
 *
 * Playback surfaces need several independent reactions to foreground/background
 * (video pause, scene clock, audio session), and a per-consumer
 * `AppState.addEventListener` means N bridge subscriptions plus duplicate work
 * for the `inactive` → `background` pair iOS emits on every backgrounding.
 * Listeners here only see real transitions of "is the app active".
 */
let subscription: NativeEventSubscription | null = null;
let lastActive = AppState.currentState === "active";
const listeners = new Set<(active: boolean) => void>();

/** Read-through — correct even before the first listener attaches. */
export function isAppActive(): boolean {
  return AppState.currentState === "active";
}

export function subscribeAppActive(listener: (active: boolean) => void): () => void {
  listeners.add(listener);
  if (!subscription) {
    lastActive = isAppActive();
    subscription = AppState.addEventListener("change", (nextState) => {
      const active = nextState === "active";
      if (active === lastActive) return;
      lastActive = active;
      listeners.forEach((entry) => entry(active));
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    subscription?.remove();
    subscription = null;
  };
}

/** Runs `onChange` on every foreground/background transition while mounted. */
export function useAppActiveChange(onChange: (active: boolean) => void): void {
  const handleChange = useEffectEvent(onChange);
  useEffect(() => subscribeAppActive((active) => handleChange(active)), []);
}

export function useAppActive(): boolean {
  return useSyncExternalStore(subscribeAppActive, isAppActive, isAppActive);
}

/**
 * Whether this screen should be producing sound and motion: the app is
 * foregrounded *and* the screen still holds navigation focus. Blur matters on
 * its own — a native stack keeps a screen mounted while it is covered or while
 * a pop animates, and playback left running there outlives the page the viewer
 * believes they closed.
 */
export function useScreenActive(): boolean {
  const appActive = useAppActive();
  const focused = useIsFocused();
  return appActive && focused;
}
