"use client";

import { useEffect, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";
import {
  CANVAS_BLOCKED_WHEEL_SELECTOR,
  CANVAS_FULLSCREEN_OWNER_SELECTOR,
  CANVAS_KEYBOARD_OWNER_SELECTOR,
  CANVAS_NATIVE_POINTER_OWNER_SELECTOR,
  CANVAS_NATIVE_WHEEL_OWNER_SELECTOR,
  CANVAS_SCROLL_OWNER_SELECTOR,
  CANVAS_WHEEL_ZOOM_OWNER_SELECTOR,
  applyCanvasZoomExponent,
  canScrollCanvasOwner,
  canvasScrollDelta,
  canvasWheelZoomExponent,
  hasCanvasScrollOverflow,
  normalizeCanvasWheelDelta,
  resolveCanvasWheelRoute,
  shouldStartCanvasPointerPan,
  translateCanvasViewport,
  type CanvasScrollAxis,
  type CanvasWheelRoute,
} from "./canvas-interaction-policy";

const REACT_FLOW_ELEMENT_SELECTOR = ".react-flow__node, .react-flow__edge";
const WHEEL_BURST_IDLE_MS = 140;

type UseCanvasInteractionOptions = {
  surfaceRef: RefObject<HTMLDivElement | null>;
  minZoom: number;
  maxZoom: number;
  panSpeed?: number;
  primaryPanActive: boolean;
  onInteractionStart?: () => void;
};

type PendingTransform = {
  translateX: number;
  translateY: number;
  zoomExponent: number;
  zoomClientX: number;
  zoomClientY: number;
};

type PendingScroll = {
  x: number;
  y: number;
};

type ActivePointerPan = {
  pointerId: number;
  clientX: number;
  clientY: number;
};

type WheelRouteLock = {
  route: CanvasWheelRoute;
  owner: HTMLElement | null;
  nativeOwner: Element | null;
  zoomIntent: boolean;
  zoomOwner: Element | null;
  lastEventAt: number;
};

function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/u.test(navigator.platform);
}

function isKeyboardOwnedTarget(target: EventTarget | null): boolean {
  return Boolean(target instanceof Element && target.closest(CANVAS_KEYBOARD_OWNER_SELECTOR));
}

function scrollAxis(element: HTMLElement): CanvasScrollAxis | null {
  const value = element.dataset.canvasScrollOwner;
  return value === "x" || value === "y" || value === "both" ? value : null;
}

/**
 * Owns canvas-level mouse and trackpad gestures before React Flow's node-level
 * `nopan` filter sees them. React Flow remains responsible for connections,
 * selection, node dragging, touch panning, and touch pinch.
 */
export function useCanvasInteraction({
  surfaceRef,
  minZoom,
  maxZoom,
  panSpeed = 1,
  primaryPanActive,
  onInteractionStart,
}: UseCanvasInteractionOptions): void {
  const { getViewport, setViewport } = useReactFlow();

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    let animationFrame = 0;
    let spacePressed = false;
    let activePointerPan: ActivePointerPan | null = null;
    let wheelRouteLock: WheelRouteLock | null = null;
    let surfaceRect = surface.getBoundingClientRect();
    const pending: PendingTransform = {
      translateX: 0,
      translateY: 0,
      zoomExponent: 0,
      zoomClientX: 0,
      zoomClientY: 0,
    };
    const pendingScrolls = new Map<HTMLElement, PendingScroll>();

    const updateSurfaceRect = () => {
      surfaceRect = surface.getBoundingClientRect();
    };
    const resizeObserver = new ResizeObserver(updateSurfaceRect);
    resizeObserver.observe(surface);

    const scheduleFrame = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;

        if (pending.translateX !== 0 || pending.translateY !== 0 || pending.zoomExponent !== 0) {
          let nextViewport = translateCanvasViewport(
            getViewport(),
            pending.translateX,
            pending.translateY
          );

          if (pending.zoomExponent !== 0) {
            nextViewport = applyCanvasZoomExponent(
              nextViewport,
              {
                x: pending.zoomClientX - surfaceRect.left,
                y: pending.zoomClientY - surfaceRect.top,
              },
              pending.zoomExponent,
              minZoom,
              maxZoom
            );
          }

          pending.translateX = 0;
          pending.translateY = 0;
          pending.zoomExponent = 0;
          void setViewport(nextViewport, { duration: 0 });
        }

        for (const [owner, delta] of pendingScrolls) {
          if (!owner.isConnected) continue;
          owner.scrollLeft += delta.x;
          owner.scrollTop += delta.y;
        }
        pendingScrolls.clear();
      });
    };

    const ownEvent = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onWheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(CANVAS_FULLSCREEN_OWNER_SELECTOR)) {
        wheelRouteLock = null;
        ownEvent(event);
        return;
      }
      const nativeOwner = target?.closest(CANVAS_NATIVE_WHEEL_OWNER_SELECTOR) ?? null;
      const zoomOwner = target?.closest(CANVAS_WHEEL_ZOOM_OWNER_SELECTOR) ?? null;
      const scrollOwner = target?.closest<HTMLElement>(CANVAS_SCROLL_OWNER_SELECTOR);
      const axis = scrollOwner ? scrollAxis(scrollOwner) : null;
      const ownerDelta =
        scrollOwner && axis
          ? normalizeCanvasWheelDelta({
              deltaX: event.deltaX,
              deltaY: event.deltaY,
              deltaMode: event.deltaMode,
              shiftKey: event.shiftKey,
              viewportWidth: scrollOwner.clientWidth,
              viewportHeight: scrollOwner.clientHeight,
            })
          : null;
      const zoomModifier = event.ctrlKey || event.metaKey;
      const zoomIntent = zoomModifier || Boolean(zoomOwner);
      const now = performance.now();
      const ownerCanScroll = Boolean(
        scrollOwner && axis && ownerDelta && canScrollCanvasOwner(scrollOwner, axis, ownerDelta)
      );
      const ownerContainsBoundary = Boolean(
        scrollOwner && axis && hasCanvasScrollOverflow(scrollOwner, axis) && !ownerCanScroll
      );
      const routeCandidate = resolveCanvasWheelRoute({
        hasNativeOwner: Boolean(nativeOwner),
        hasZoomModifier: zoomModifier,
        hasZoomOwner: Boolean(zoomOwner),
        hasScrollableOwner: ownerCanScroll,
        isBlocked: ownerContainsBoundary || Boolean(target?.closest(CANVAS_BLOCKED_WHEEL_SELECTOR)),
      });
      const shouldStartBurst =
        !wheelRouteLock ||
        now - wheelRouteLock.lastEventAt > WHEEL_BURST_IDLE_MS ||
        wheelRouteLock.zoomIntent !== zoomIntent ||
        wheelRouteLock.zoomOwner !== zoomOwner ||
        wheelRouteLock.nativeOwner !== nativeOwner ||
        (wheelRouteLock.route === "scroll" && wheelRouteLock.owner !== scrollOwner);

      if (shouldStartBurst) {
        wheelRouteLock = {
          route: routeCandidate,
          owner: routeCandidate === "scroll" ? (scrollOwner ?? null) : null,
          nativeOwner,
          zoomIntent,
          zoomOwner,
          lastEventAt: now,
        };
      } else if (wheelRouteLock) {
        wheelRouteLock.lastEventAt = now;
      }
      if (!wheelRouteLock) return;
      const activeRouteLock = wheelRouteLock;

      if (activeRouteLock.route === "native") {
        // The embedded surface still receives the event, while the root keeps
        // browser zoom/history navigation out of the gesture contract.
        event.preventDefault();
        return;
      }

      if (activeRouteLock.route === "zoom") {
        onInteractionStart?.();
        ownEvent(event);
        pending.zoomExponent += canvasWheelZoomExponent(
          event.deltaY,
          event.deltaMode,
          event.ctrlKey && isApplePlatform()
        );
        pending.zoomClientX = activeRouteLock.zoomOwner
          ? surfaceRect.left + surfaceRect.width / 2
          : event.clientX;
        pending.zoomClientY = activeRouteLock.zoomOwner
          ? surfaceRect.top + surfaceRect.height / 2
          : event.clientY;
        scheduleFrame();
        return;
      }

      if (activeRouteLock.route === "scroll" && activeRouteLock.owner) {
        ownEvent(event);
        const activeOwner = activeRouteLock.owner;
        const activeAxis = scrollAxis(activeOwner);
        if (!activeAxis) return;
        const activeDelta = normalizeCanvasWheelDelta({
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          shiftKey: event.shiftKey,
          viewportWidth: activeOwner.clientWidth,
          viewportHeight: activeOwner.clientHeight,
        });
        const routedDelta = canvasScrollDelta(activeAxis, activeDelta);
        const accumulated = pendingScrolls.get(activeOwner) ?? { x: 0, y: 0 };
        accumulated.x += routedDelta.x;
        accumulated.y += routedDelta.y;
        pendingScrolls.set(activeOwner, accumulated);
        scheduleFrame();
        return;
      }

      // `nowheel` marks a control that intentionally blocks canvas gestures but
      // does not itself scroll. Scrollable controls use data-canvas-scroll-owner.
      if (activeRouteLock.route === "blocked") {
        ownEvent(event);
        return;
      }

      ownEvent(event);
      onInteractionStart?.();
      const canvasDelta = normalizeCanvasWheelDelta({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        shiftKey: event.shiftKey,
        viewportWidth: surfaceRect.width,
        viewportHeight: surfaceRect.height,
      });
      pending.translateX -= canvasDelta.x * panSpeed;
      pending.translateY -= canvasDelta.y * panSpeed;
      scheduleFrame();
    };

    const setSpacePressed = (pressed: boolean) => {
      spacePressed = pressed;
      if (pressed) surface.dataset.canvasPanReady = "true";
      else delete surface.dataset.canvasPanReady;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (!surface.matches(":hover") && !surface.contains(document.activeElement)) ||
        isKeyboardOwnedTarget(event.target)
      ) {
        return;
      }
      if (surface.querySelector(CANVAS_FULLSCREEN_OWNER_SELECTOR)) {
        setSpacePressed(false);
        return;
      }
      event.preventDefault();
      setSpacePressed(true);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(false);
    };

    const finishPointerPan = (pointerId?: number) => {
      if (!activePointerPan || (pointerId != null && activePointerPan.pointerId !== pointerId)) {
        return;
      }
      const finishedPointerId = activePointerPan.pointerId;
      activePointerPan = null;
      delete surface.dataset.canvasPanning;
      if (surface.hasPointerCapture(finishedPointerId)) {
        surface.releasePointerCapture(finishedPointerId);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || activePointerPan) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(REACT_FLOW_ELEMENT_SELECTOR)) return;
      if (target.closest(CANVAS_FULLSCREEN_OWNER_SELECTOR)) {
        setSpacePressed(false);
        return;
      }

      if (
        !shouldStartCanvasPointerPan({
          button: event.button,
          hasNativePointerOwner: Boolean(target.closest(CANVAS_NATIVE_POINTER_OWNER_SELECTOR)),
          primaryPanActive,
          spacePressed,
        })
      ) {
        return;
      }

      onInteractionStart?.();
      ownEvent(event);
      activePointerPan = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      surface.setPointerCapture(event.pointerId);
      surface.dataset.canvasPanning = "true";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!activePointerPan || activePointerPan.pointerId !== event.pointerId) return;
      ownEvent(event);
      pending.translateX += event.clientX - activePointerPan.clientX;
      pending.translateY += event.clientY - activePointerPan.clientY;
      activePointerPan.clientX = event.clientX;
      activePointerPan.clientY = event.clientY;
      scheduleFrame();
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (!activePointerPan || activePointerPan.pointerId !== event.pointerId) return;
      ownEvent(event);
      finishPointerPan(event.pointerId);
    };

    const resetInteraction = () => {
      wheelRouteLock = null;
      setSpacePressed(false);
      finishPointerPan();
    };

    surface.addEventListener("wheel", onWheel, { capture: true, passive: false });
    surface.addEventListener("pointerdown", onPointerDown, { capture: true });
    surface.addEventListener("pointermove", onPointerMove, { capture: true });
    surface.addEventListener("pointerup", onPointerEnd, { capture: true });
    surface.addEventListener("pointercancel", onPointerEnd, { capture: true });
    surface.addEventListener("lostpointercapture", resetInteraction);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", resetInteraction);

    return () => {
      resizeObserver.disconnect();
      surface.removeEventListener("wheel", onWheel, { capture: true });
      surface.removeEventListener("pointerdown", onPointerDown, { capture: true });
      surface.removeEventListener("pointermove", onPointerMove, { capture: true });
      surface.removeEventListener("pointerup", onPointerEnd, { capture: true });
      surface.removeEventListener("pointercancel", onPointerEnd, { capture: true });
      surface.removeEventListener("lostpointercapture", resetInteraction);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", resetInteraction);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      pendingScrolls.clear();
      resetInteraction();
    };
  }, [
    getViewport,
    maxZoom,
    minZoom,
    onInteractionStart,
    panSpeed,
    primaryPanActive,
    setViewport,
    surfaceRef,
  ]);
}
