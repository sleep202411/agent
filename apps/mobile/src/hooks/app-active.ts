import { AppState } from "react-native";
import type { NativeEventSubscription } from "react-native";

/**
 * One native AppState subscription for the whole app, fanned out to listeners.
 *
 * Kept out of `use-app-active` so route layouts can read foreground state
 * without importing expo-router (that cycle leaves React hooks undefined).
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
