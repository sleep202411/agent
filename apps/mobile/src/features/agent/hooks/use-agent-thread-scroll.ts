import { useCallback, useEffect, useRef, type DependencyList } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

const PIN_THRESHOLD_PX = 72;

type ThreadScrollViewRef = {
  scrollToEnd: (options?: { animated?: boolean }) => void;
};

/**
 * WeChat-style transcript scrolling:
 * - pinned to bottom → follow new messages / activity rows
 * - user scrolls up → stay put until they send again
 */
export function useAgentThreadScroll(scrollDeps: DependencyList) {
  const scrollRef = useRef<ThreadScrollViewRef>(null);
  const pinnedRef = useRef(true);

  const scrollToLatest = useCallback((animated = true) => {
    pinnedRef.current = true;
    scrollRef.current?.scrollToEnd({ animated });
  }, []);

  const handleEndVisible = useCallback((visible: boolean) => {
    pinnedRef.current = visible;
  }, []);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    if (contentSize.height <= layoutMeasurement.height + 1) {
      pinnedRef.current = true;
      return;
    }
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    pinnedRef.current = distanceFromBottom <= PIN_THRESHOLD_PX;
  }, []);

  const handleContentSizeChange = useCallback(() => {
    if (!pinnedRef.current) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    });
  }, []);

  useEffect(() => {
    if (!pinnedRef.current) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies transcript deps
  }, scrollDeps);

  return {
    scrollRef,
    handleScroll,
    handleContentSizeChange,
    scrollToLatest,
    handleEndVisible,
  };
}
