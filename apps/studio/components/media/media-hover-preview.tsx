"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEventHandler,
  type ReactNode,
  type WheelEventHandler,
} from "react";
import {
  DEFAULT_MEDIA_HOVER_PREVIEW_DELAY_MS,
  MediaPreviewCoordinator,
  type MediaManualPlaybackLease,
  type MediaPreviewOwnership,
} from "./media-preview-coordinator";

const POINTER_STABILITY_DISTANCE_PX = 6;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const FINE_HOVER_QUERY = "(hover: hover) and (pointer: fine)";

type HoverActivationGuard = (element: HTMLElement) => boolean;

type MediaHoverPreviewOptions = {
  ownerId: string;
  enabled?: boolean;
  canActivate?: HoverActivationGuard;
  canClaimManual?: HoverActivationGuard;
};

type MediaHoverPreviewBindings = {
  isAutoPreviewActive: boolean;
  isManualPlaybackOwner: boolean;
  acquireManualPlayback: () => MediaManualPlaybackLease | null;
  releaseManualPlayback: (lease: MediaManualPlaybackLease) => void;
  hoverProps: {
    onPointerEnter: PointerEventHandler<HTMLElement>;
    onPointerMove: PointerEventHandler<HTMLElement>;
    onPointerLeave: PointerEventHandler<HTMLElement>;
    onPointerCancel: PointerEventHandler<HTMLElement>;
    onPointerDownCapture: PointerEventHandler<HTMLElement>;
    onWheelCapture: WheelEventHandler<HTMLElement>;
  };
};

const MediaHoverPreviewContext = createContext<MediaPreviewCoordinator | null>(null);

export function MediaHoverPreviewProvider({
  children,
  delayMs = DEFAULT_MEDIA_HOVER_PREVIEW_DELAY_MS,
}: {
  children: ReactNode;
  delayMs?: number;
}) {
  const [coordinator] = useState(() => new MediaPreviewCoordinator(delayMs));

  useEffect(() => {
    const stopAll = () => coordinator.stopAll();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") stopAll();
    };
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    const fineHover = window.matchMedia(FINE_HOVER_QUERY);
    const connection = getNetworkInformation();
    const onReducedMotionChange = (event: MediaQueryListEvent) => {
      if (event.matches) coordinator.interruptHover();
    };
    const onFineHoverChange = (event: MediaQueryListEvent) => {
      if (!event.matches) coordinator.interruptHover();
    };
    const onConnectionChange = () => {
      if (connection?.saveData) coordinator.interruptHover();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", stopAll);
    window.addEventListener("pagehide", stopAll);
    reducedMotion.addEventListener("change", onReducedMotionChange);
    fineHover.addEventListener("change", onFineHoverChange);
    connection?.addEventListener("change", onConnectionChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", stopAll);
      window.removeEventListener("pagehide", stopAll);
      reducedMotion.removeEventListener("change", onReducedMotionChange);
      fineHover.removeEventListener("change", onFineHoverChange);
      connection?.removeEventListener("change", onConnectionChange);
      coordinator.dispose();
    };
  }, [coordinator]);

  return (
    <MediaHoverPreviewContext.Provider value={coordinator}>
      {children}
    </MediaHoverPreviewContext.Provider>
  );
}

export function useMediaHoverPreview({
  ownerId,
  enabled = true,
  canActivate,
  canClaimManual,
}: MediaHoverPreviewOptions): MediaHoverPreviewBindings {
  const coordinator = useContext(MediaHoverPreviewContext);
  if (!coordinator) {
    throw new Error("useMediaHoverPreview must be used inside MediaHoverPreviewProvider.");
  }

  const hoveredElementRef = useRef<HTMLElement | null>(null);
  const pointerAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const ownership = useSyncExternalStore<MediaPreviewOwnership>(
    coordinator.subscribe,
    () => coordinator.ownership(ownerId),
    () => "idle"
  );

  const cancelHover = useCallback(() => {
    coordinator.cancelHover(ownerId);
    hoveredElementRef.current = null;
    pointerAnchorRef.current = null;
  }, [coordinator, ownerId]);

  const armHover = useCallback(
    (element: HTMLElement, point: { x: number; y: number }) => {
      hoveredElementRef.current = element;
      pointerAnchorRef.current = point;
      if (!enabled || !automaticMediaPreviewAllowed()) {
        coordinator.cancelHover(ownerId);
        return;
      }

      coordinator.requestHover(ownerId, () => {
        const currentElement = hoveredElementRef.current;
        return Boolean(
          enabled &&
          currentElement?.isConnected &&
          currentElement.matches(":hover") &&
          automaticMediaPreviewAllowed() &&
          (canActivate?.(currentElement) ?? true)
        );
      });
    },
    [canActivate, coordinator, enabled, ownerId]
  );

  const onPointerEnter = useCallback<PointerEventHandler<HTMLElement>>(
    (event) => {
      if (event.pointerType !== "mouse" || !event.isPrimary || event.buttons !== 0) {
        cancelHover();
        return;
      }
      armHover(event.currentTarget, { x: event.clientX, y: event.clientY });
    },
    [armHover, cancelHover]
  );

  const onPointerMove = useCallback<PointerEventHandler<HTMLElement>>(
    (event) => {
      if (event.pointerType !== "mouse" || !event.isPrimary || event.buttons !== 0) {
        cancelHover();
        return;
      }
      if (ownership !== "pending") {
        return;
      }
      const anchor = pointerAnchorRef.current;
      if (!anchor) return;
      if (
        Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y) <
        POINTER_STABILITY_DISTANCE_PX
      ) {
        return;
      }
      armHover(event.currentTarget, { x: event.clientX, y: event.clientY });
    },
    [armHover, cancelHover, ownership]
  );

  const interruptOwnerHover = useCallback(() => {
    coordinator.cancelHover(ownerId);
    pointerAnchorRef.current = null;
  }, [coordinator, ownerId]);

  useEffect(() => {
    if (!enabled) coordinator.cancelHover(ownerId);
  }, [coordinator, enabled, ownerId]);

  useEffect(
    () => () => {
      coordinator.cancelHover(ownerId);
    },
    [coordinator, ownerId]
  );

  const acquireManualPlayback = useCallback(() => {
    if (coordinator.ownership(ownerId) === "manual") {
      return coordinator.claimManual(ownerId);
    }

    const currentElement = hoveredElementRef.current;
    if (currentElement && !(canClaimManual?.(currentElement) ?? true)) return null;
    return coordinator.claimManual(ownerId);
  }, [canClaimManual, coordinator, ownerId]);
  const releaseManualPlayback = useCallback(
    (lease: MediaManualPlaybackLease) => {
      coordinator.releaseManual(lease);
    },
    [coordinator]
  );

  const hoverProps = useMemo(
    () => ({
      onPointerEnter,
      onPointerMove,
      onPointerLeave: cancelHover,
      onPointerCancel: cancelHover,
      onPointerDownCapture: interruptOwnerHover,
      onWheelCapture: interruptOwnerHover,
    }),
    [cancelHover, interruptOwnerHover, onPointerEnter, onPointerMove]
  );

  return {
    isAutoPreviewActive: ownership === "hover",
    isManualPlaybackOwner: ownership === "manual",
    acquireManualPlayback,
    releaseManualPlayback,
    hoverProps,
  };
}

export function useMediaHoverPreviewInterruption(): () => void {
  const coordinator = useContext(MediaHoverPreviewContext);
  if (!coordinator) {
    throw new Error(
      "useMediaHoverPreviewInterruption must be used inside MediaHoverPreviewProvider."
    );
  }
  return coordinator.interruptHover;
}

function automaticMediaPreviewAllowed(): boolean {
  if (document.visibilityState !== "visible") return false;
  if (!window.matchMedia(FINE_HOVER_QUERY).matches) return false;
  if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return false;

  const connection = getNetworkInformation();
  return connection?.saveData !== true;
}

type NetworkInformationLike = Pick<EventTarget, "addEventListener" | "removeEventListener"> & {
  saveData?: boolean;
};

function getNetworkInformation(): NetworkInformationLike | undefined {
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}
