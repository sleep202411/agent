import { useIsFocused } from "expo-router";
import { createContext, useContext, useEffect, useEffectEvent, useSyncExternalStore } from "react";

import { isAppActive, subscribeAppActive } from "./app-active";

export { isAppActive, subscribeAppActive } from "./app-active";

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

/**
 * Host-owned pause, ANDed into `useGatedScreenActive` by every consumer under the
 * provider. A screen sometimes has to freeze mounted playback for reasons
 * navigation knows nothing about — a chapter switch in flight, a blocking
 * overlay — and the components that own the media sit far below its props.
 */
export const ScreenActiveGateContext = createContext(true);

export function useGatedScreenActive(): boolean {
  const screenActive = useScreenActive();
  const hostActive = useContext(ScreenActiveGateContext);
  return screenActive && hostActive;
}
