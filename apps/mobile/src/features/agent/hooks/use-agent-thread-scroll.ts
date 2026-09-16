import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

const PIN_THRESHOLD_PX = 72;
/** Coalesce nested layout (storyboard clips) after the last size change. */
const SETTLE_MS = 160;
/** Don't keep the restore overlay forever if a nested fetch hangs. */
const MAX_HIDDEN_MS = 2500;

type ThreadScrollViewRef = {
  scrollToEnd: (options?: { animated?: boolean }) => void;
};

type HydrateLock = {
  begin: () => void;
  end: () => void;
};

const ThreadScrollHydrateContext = createContext<HydrateLock | null>(null);

/**
 * Hold the restore overlay while a nested transcript block is still fetching
 * its first payload (generation batch / storyboard). H5 MessageScroller keeps
 * the tail glued with overflow-anchor; native has to wait until that height
 * exists before painting, or the list snaps twice.
 */
export function useThreadScrollHydrateLock(held: boolean) {
  const lock = useContext(ThreadScrollHydrateContext);
  useLayoutEffect(() => {
    if (!lock || !held) return;
    lock.begin();
    return () => lock.end();
  }, [held, lock]);
}

export function AgentThreadHydrateLockProvider({
  value,
  children,
}: {
  value: HydrateLock;
  children: ReactNode;
}) {
  return createElement(ThreadScrollHydrateContext.Provider, { value }, children);
}

/**
 * Chat transcript scrolling, aligned with H5 `MessageScrollerProvider
 * autoScroll defaultScrollPosition="end"`:
 * - history stays hidden until the tail height has settled (no tween)
 * - pinned to bottom → follow growth without a scroll animation
 * - user scrolls up → stay put until they send again
 */
export function useAgentThreadScroll(resetKey?: string) {
  const scrollRef = useRef<ThreadScrollViewRef>(null);
  const pinnedRef = useRef(true);
  const revealedRef = useRef(false);
  const pendingHydrateRef = useRef(0);
  const contentHeightRef = useRef(0);
  const sawThreadLayoutRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [revealed, setRevealed] = useState(false);

  const pinToEnd = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);

  const clearSettle = () => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  };

  const clearMax = () => {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  };

  const reveal = useCallback(() => {
    if (revealedRef.current) return;
    if (!sawThreadLayoutRef.current) return;
    revealedRef.current = true;
    clearSettle();
    clearMax();
    pinToEnd();
    setRevealed(true);
  }, [pinToEnd]);

  const armMaxHidden = useCallback(() => {
    if (revealedRef.current || maxTimerRef.current) return;
    maxTimerRef.current = setTimeout(() => {
      maxTimerRef.current = null;
      reveal();
    }, MAX_HIDDEN_MS);
  }, [reveal]);

  const scheduleRevealRef = useRef(() => {});
  useLayoutEffect(() => {
    scheduleRevealRef.current = () => {
      if (revealedRef.current) return;
      if (!sawThreadLayoutRef.current) return;
      if (pendingHydrateRef.current > 0) return;
      clearSettle();
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        if (pendingHydrateRef.current > 0 || revealedRef.current) return;
        reveal();
      }, SETTLE_MS);
    };
  });

  const [previousResetKey, setPreviousResetKey] = useState(resetKey);
  if (previousResetKey !== resetKey) {
    setPreviousResetKey(resetKey);
    setRevealed(false);
  }

  const hydrateLock = useMemo<HydrateLock>(
    () => ({
      begin: () => {
        pendingHydrateRef.current += 1;
        clearSettle();
      },
      end: () => {
        pendingHydrateRef.current = Math.max(0, pendingHydrateRef.current - 1);
        scheduleRevealRef.current();
      },
    }),
    []
  );

  useEffect(() => {
    pinnedRef.current = true;
    revealedRef.current = false;
    sawThreadLayoutRef.current = false;
    contentHeightRef.current = 0;
    clearSettle();
    clearMax();
    return () => {
      clearSettle();
      clearMax();
    };
    // Reset only when the thread identity changes.
  }, [resetKey]);

  const scrollToLatest = useCallback(
    (animated = false) => {
      pinnedRef.current = true;
      if (animated) {
        sawThreadLayoutRef.current = true;
        reveal();
        scrollRef.current?.scrollToEnd({ animated: true });
        return;
      }
      pinToEnd();
      scheduleRevealRef.current();
    },
    [pinToEnd, reveal]
  );

  const handleEndVisible = useCallback((visible: boolean) => {
    if (!revealedRef.current) {
      pinnedRef.current = true;
      return;
    }
    pinnedRef.current = visible;
  }, []);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    contentHeightRef.current = contentSize.height;
    if (!revealedRef.current) {
      pinnedRef.current = true;
      return;
    }
    if (contentSize.height <= layoutMeasurement.height + 1) {
      pinnedRef.current = true;
      return;
    }
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    pinnedRef.current = distanceFromBottom <= PIN_THRESHOLD_PX;
  }, []);

  const handleContentSizeChange = useCallback(
    (...args: unknown[]) => {
      const nextHeight = typeof args[1] === "number" ? args[1] : undefined;
      if (typeof nextHeight === "number") {
        const delta = nextHeight - contentHeightRef.current;
        contentHeightRef.current = nextHeight;
        sawThreadLayoutRef.current = true;
        armMaxHidden();
        if (!pinnedRef.current) return;
        // H5 overflow-anchor does not JS-scroll when the tail did not grow.
        // Repeating scrollToEnd at the same offset flickers on iOS.
        if (revealedRef.current && delta <= 1) return;
      } else if (!pinnedRef.current) {
        return;
      }
      requestAnimationFrame(() => {
        pinToEnd();
        scheduleRevealRef.current();
      });
    },
    [armMaxHidden, pinToEnd]
  );

  return {
    scrollRef,
    handleScroll,
    handleContentSizeChange,
    scrollToLatest,
    handleEndVisible,
    revealed,
    hydrateLock,
  };
}
