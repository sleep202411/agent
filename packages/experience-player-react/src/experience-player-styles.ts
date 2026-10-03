/**
 * The player's primary action, filled with the theme's accent. One per view:
 * Start, a story's Continue, Play again, and the paused frame's button after a
 * refusal — never two on screen at once.
 */
export const PRIMARY_BUTTON =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--experience-color-accent,#ea2804)] px-7 text-sm font-semibold text-white outline-none transition-colors hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none";
