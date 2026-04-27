"use client";

import { useEffect, useState } from "react";

/**
 * `true` when the page is running inside an `<iframe>` (cross-origin
 * frame access throws — that's also treated as "in iframe").
 *
 * Used to hide global chrome (nav, footer, workspace shell) when an
 * embedder provides its own surrounding UI.
 */
export function useIsInIframe(): boolean {
  const [inIframe, setInIframe] = useState(false);
  useEffect(() => {
    try {
      setInIframe(window.self !== window.top);
    } catch {
      setInIframe(true);
    }
  }, []);
  return inIframe;
}
