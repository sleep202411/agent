"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useProjectUIStore } from "../_stores/project-ui-store";

/** Home's explicit project submission opens the Agent with a one-shot draft. */
export function useProjectPromptHandoff() {
  const params = useSearchParams();
  const text = params.get("prompt");
  const request = useMemo(() => (text?.trim() ? { id: 1, text } : null), [text]);
  useEffect(() => {
    if (request) useProjectUIStore.setState({ copilotOpen: true });
  }, [request]);
  const consume = useCallback(() => {
    const url = new URL(window.location.href);
    // Do not remove a newer handoff that arrived before the old bridge completed.
    if (url.searchParams.get("prompt") !== text) return;
    url.searchParams.delete("prompt");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [text]);
  return { request, consume };
}
