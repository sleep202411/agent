import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from "react";

/** Only viewer activity keeps chrome visible; story progress never renews it. */
export function useExperienceTransportVisibility({
  available,
  paused,
}: {
  available: boolean;
  paused: boolean;
}) {
  const [shown, setShown] = useState(false);
  const stateRef = useRef({ available, paused });
  stateRef.current = { available, paused };
  const visible = available && (paused || shown);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const focusedRef = useRef(false);
  const hoveredRef = useRef(false);
  const wakeTapRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  const scheduleHide = useCallback(() => {
    clearTimer();
    const state = stateRef.current;
    if (!state.available || state.paused || focusedRef.current || hoveredRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!stateRef.current.paused && !focusedRef.current && !hoveredRef.current) setShown(false);
    }, 3000);
  }, [clearTimer]);
  const reveal = useCallback(() => {
    if (!stateRef.current.available) return;
    visibleRef.current = true;
    setShown(true);
    scheduleHide();
  }, [scheduleHide]);
  useEffect(() => {
    wakeTapRef.current = false;
    if (!available) {
      focusedRef.current = false;
      hoveredRef.current = false;
      setShown(false);
      clearTimer();
    } else reveal();
    return clearTimer;
  }, [available, paused, clearTimer, reveal]);
  const consumeWakeTap = useCallback(() => {
    const wake = wakeTapRef.current;
    wakeTapRef.current = false;
    return wake;
  }, []);
  return {
    visible,
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") reveal();
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      wakeTapRef.current =
        event.pointerType === "touch" && stateRef.current.available && !visibleRef.current;
      reveal();
    },
    onKeyDownCapture: reveal,
    consumeWakeTap,
    onFocusCapture: () => {
      focusedRef.current = true;
      reveal();
    },
    onBlurCapture: (event: FocusEvent<HTMLElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
        return;
      focusedRef.current = false;
      scheduleHide();
    },
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch") return;
      hoveredRef.current = true;
      reveal();
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch") return;
      hoveredRef.current = false;
      scheduleHide();
    },
  };
}
