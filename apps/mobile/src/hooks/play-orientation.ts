/**
 * Card push, not a modal — so the native back chevron stays. `animation: none`
 * so the portrait tabs VC is gone before landscape applies; a fade would keep
 * both masks alive and RNScreens snaps back to the phone's portrait heading.
 *
 * Direction is not set here. Any Stack `orientation` makes iOS ignore
 * expo-screen-orientation, so the play hook locks with `lockAsync` instead.
 */

export const PLAY_ROUTE_NAV_OPTIONS = {
  animation: "none" as const,
  headerBackButtonMenuEnabled: false,
  gestureEnabled: false,
  fullScreenGestureEnabled: false,
};
