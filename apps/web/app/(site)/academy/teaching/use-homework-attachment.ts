"use client";
import { useEffect, useRef, useState } from "react";

/** Reserve a tab during the click; preserve the review form if popups are blocked. */
export function useHomeworkAttachment() {
  const operation = useRef<AbortController | null>(null);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  useEffect(
    () => () => {
      operation.current?.abort();
      if (expiry.current) clearTimeout(expiry.current);
    },
    []
  );
  async function open(
    id: string,
    load: (signal: AbortSignal) => Promise<string>,
    failed: (error: unknown) => void
  ) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    let target: Window | null = null;
    setPending(true);
    setLink(null);
    if (expiry.current) clearTimeout(expiry.current);
    const close = () => target?.close();
    try {
      target = window.open("about:blank", "_blank");
      if (target) target.opener = null;
      controller.signal.addEventListener("abort", close, { once: true });
      const url = await load(controller.signal);
      if (controller.signal.aborted) return;
      if (target && !target.closed) target.location.replace(url);
      else {
        setLink({ id, url });
        // Server URLs live for 120 seconds. Never leave an expired fallback link in the form.
        expiry.current = setTimeout(() => setLink(null), 60000);
      }
    } catch (error) {
      close();
      if (!controller.signal.aborted) failed(error);
    } finally {
      controller.signal.removeEventListener("abort", close);
      operation.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return { open, pending, link };
}
