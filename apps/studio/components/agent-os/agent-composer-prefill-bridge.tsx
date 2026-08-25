"use client";

import { useEffect } from "react";

/**
 * Applies a host-suggested draft only while the real composer subtree is
 * mounted. Approval and structured-input gates replace that subtree, so a
 * suggestion can never be consumed invisibly behind a blocking decision.
 */
export function AgentComposerPrefillBridge({
  request,
  onPrefill,
  onConsumed,
}: {
  request: { id: number; text: string } | null | undefined;
  onPrefill: (text: string) => void;
  onConsumed?: (id: number) => void;
}) {
  useEffect(() => {
    if (!request) return;
    const frame = window.requestAnimationFrame(() => {
      onPrefill(request.text);
      onConsumed?.(request.id);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [onConsumed, onPrefill, request]);

  return null;
}
