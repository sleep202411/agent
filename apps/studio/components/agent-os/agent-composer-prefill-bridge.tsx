"use client";

import { useEffect } from "react";

/**
 * Applies a host-suggested draft while the stable composer subtree is mounted.
 * Decision surfaces sit above that subtree, so the suggested text stays
 * visible even though submission remains paused until the decision resolves.
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
