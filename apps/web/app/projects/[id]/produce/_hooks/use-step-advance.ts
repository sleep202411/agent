"use client";

/**
 * Hook + store for the wizard footer's "下一步" button to invoke
 * page-level commit work BEFORE navigating to the next step.
 *
 * Producer side (each step page):
 *   const { setHandler } = useStepAdvanceController();
 *   useEffect(() => {
 *     setHandler(async () => {
 *       await pipeline.commit();
 *       router.push(`/projects/${projectId}/produce/${nextKey}`);
 *     });
 *     return () => setHandler(null);
 *   }, [...deps]);
 *
 * Consumer side (`produce/layout.tsx`):
 *   const handler = useStepAdvanceHandler();
 *   <Button onClick={handler ?? defaultLinkNav}>下一步</Button>
 *
 * Why a module-level store rather than React context: the producer
 * (page) and consumer (layout) live in separate component trees in
 * Next.js's App Router (the page renders inside the layout, but the
 * layout's button is a sibling of `children`, not a descendant). A
 * `useSyncExternalStore`-backed module ref is the smallest thing
 * that surfaces handler changes to the layout without dragging the
 * whole tree through context.
 *
 * Each route owns at most one handler — a fresh page mount overwrites
 * the prior handler, and the cleanup on unmount clears it. Don't try
 * to stack handlers; if a step has both pre-commit and post-navigate
 * concerns, fold them into one handler closure.
 */

import { useCallback, useSyncExternalStore } from "react";

type Handler = () => void | Promise<void>;

let currentHandler: Handler | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) {
    try {
      fn();
    } catch (err) {
      console.warn("[useStepAdvance] subscriber threw:", err);
    }
  }
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function getSnapshot(): Handler | null {
  return currentHandler;
}

function getServerSnapshot(): Handler | null {
  return null;
}

/**
 * Read-only access to the registered handler. Re-renders the calling
 * component whenever the handler is replaced or cleared.
 */
export function useStepAdvanceHandler(): Handler | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Producer-side API for pages to register / clear their handler.
 */
export function useStepAdvanceController(): {
  setHandler: (handler: Handler | null) => void;
} {
  const setHandler = useCallback((handler: Handler | null) => {
    currentHandler = handler;
    notify();
  }, []);
  return { setHandler };
}
