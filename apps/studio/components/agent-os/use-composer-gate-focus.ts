"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Composer-only HITL cards temporarily replace the message field. Move focus
 * into the newly actionable region, then hand it back to the recreated input
 * when the decision settles. This mirrors the structured-question card while
 * keeping operation cards out of the transcript.
 */
export function useComposerGateFocus<T extends HTMLElement>(gateKey: string): RefObject<T | null> {
  const targetRef = useRef<T | null>(null);

  useEffect(() => {
    const target = targetRef.current;
    const gate = target?.closest<HTMLElement>("[data-agent-composer-gate]") ?? null;
    const focusFrame = window.requestAnimationFrame(() => target?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      const shouldRestore = Boolean(
        gate?.contains(document.activeElement) || document.activeElement === document.body
      );
      if (!shouldRestore) return;
      window.requestAnimationFrame(() => {
        // A user or another surface may have claimed focus since cleanup.
        if (document.activeElement !== document.body && !gate?.contains(document.activeElement)) {
          return;
        }
        const composer = document.querySelector<HTMLElement>("[data-agent-composer-input]");
        composer?.focus();
      });
    };
  }, [gateKey]);

  return targetRef;
}
