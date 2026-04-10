import { useCallback, useEffect, useRef, useState } from "react";

const NEAR_BOTTOM_THRESHOLD = 80; // px from bottom to consider "at bottom"
const DEBUG = true;

function log(...args: unknown[]) {
  if (DEBUG) console.log("[auto-scroll]", ...args);
}

/**
 * Auto-scroll hook for chat interfaces.
 *
 * - Scrolls to bottom when new content arrives, IF user was near bottom
 * - Stops scrolling when user scrolls up to read history
 * - Shows a "scroll to bottom" indicator when not at bottom
 * - Provides `scrollToBottom` to imperatively jump down
 */
export function useAutoScroll(deps: {
  containerRef: React.RefObject<HTMLElement | null>;
  triggers: unknown[];
}) {
  const { containerRef } = deps;

  // Whether user was at bottom BEFORE the latest content arrived.
  // This is the source of truth for "should we auto-scroll?"
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const programmaticScrollRef = useRef(false);

  // ─── Helpers ─────────────────────────────────────────

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const el = containerRef.current;
      if (!el) return;
      log("scrollToBottom:", behavior);
      programmaticScrollRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior });
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      // Reset programmatic flag after scroll settles
      setTimeout(() => {
        programmaticScrollRef.current = false;
      }, 300);
    },
    [containerRef]
  );

  // ─── Track scroll position ───────────────────────────
  // Only user-initiated scrolls update the "at bottom" state.

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      // Ignore scrolls we triggered ourselves
      if (programmaticScrollRef.current) return;

      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = dist < NEAR_BOTTOM_THRESHOLD;
      log("user scroll: dist =", dist, "atBottom =", atBottom);
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [containerRef]);

  // ─── Auto-scroll on trigger changes ──────────────────
  // Decision is based on isAtBottomRef (set by last user scroll),
  // NOT by re-checking the current scroll position (which may be stale).

  useEffect(() => {
    const shouldScroll = isAtBottomRef.current;
    log("trigger:", deps.triggers, "shouldScroll:", shouldScroll);

    if (!shouldScroll) {
      log("skipped: user scrolled away");
      return;
    }

    // Double rAF to ensure DOM has updated after React render
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom("smooth");
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps.triggers);

  // ─── Instant scroll on first mount ───────────────────

  useEffect(() => {
    log("mount: instant scroll");
    // Wait for initial render
    requestAnimationFrame(() => {
      scrollToBottom("instant");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isAtBottom, scrollToBottom };
}
