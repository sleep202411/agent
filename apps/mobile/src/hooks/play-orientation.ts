export type StackOrientation = "portrait_up" | "landscape";

/**
 * Card push, not a modal — so the native back chevron stays. `animation: none`
 * so the portrait tabs VC is gone before landscape applies; a fade would keep
 * both masks alive and RNScreens snaps back to the phone's portrait heading.
 */

export const APP_STACK_ORIENTATION: StackOrientation = "portrait_up";
export const PLAY_STACK_ORIENTATION: StackOrientation = "landscape";

export const PLAY_ROUTE_SCREEN_OPTIONS = {
  orientation: PLAY_STACK_ORIENTATION,
  animation: "none" as const,
  headerBackButtonMenuEnabled: false,
  gestureEnabled: false,
  fullScreenGestureEnabled: false,
};

export function windowMatchesTarget(
  width: number,
  height: number,
  target: "portrait" | "landscape"
): boolean {
  return target === "portrait" ? height >= width : width > height;
}
