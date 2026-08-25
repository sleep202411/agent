"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AgentOsMarkdown } from "./agent-os-markdown";

/**
 * Progressive reveal + live Markdown for Agent OS assistant bubbles.
 *
 * Transport may deliver `target` in chunky jumps (poll / Ably batch). We still
 * ease the visible string with rAF so growth feels continuous, then paint that
 * string through GFM Markdown — not only after the turn ends.
 *
 * Markdown re-parse is throttled (~48ms) while streaming so half-open tables
 * do not re-layout on every animation frame; the final frame always snaps to
 * full `target` when `active` flips false.
 */
export function SmoothStreamMarkdown({
  target,
  active,
  className,
  caret = false,
}: {
  target: string;
  active: boolean;
  className?: string;
  caret?: boolean;
}) {
  const [shown, setShown] = useState("");
  const [paint, setPaint] = useState("");
  const shownRef = useRef("");
  const targetRef = useRef(target);
  const lastPaintAtRef = useRef(0);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  // rAF progressive catch-up while streaming.
  useEffect(() => {
    if (!active) return;

    let raf = 0;
    const tick = () => {
      const want = targetRef.current;
      const have = shownRef.current;

      if (want !== have) {
        if (have.length > 0 && !want.startsWith(have)) {
          shownRef.current = want;
          setShown(want);
        } else {
          const lag = want.length - have.length;
          let step = 1;
          if (lag > 120) step = Math.ceil(lag / 5);
          else if (lag > 48) step = 6;
          else if (lag > 20) step = 3;
          else if (lag > 8) step = 2;

          const next = want.slice(0, Math.min(have.length + step, want.length));
          shownRef.current = next;
          setShown(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // Throttle Markdown paints while streaming; always flush when caught up.
  useEffect(() => {
    if (!active) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const caughtUp = shown === targetRef.current;
    const due = now - lastPaintAtRef.current >= 48;
    if (caughtUp || due || paint.length === 0) {
      const frame = window.requestAnimationFrame(() => {
        lastPaintAtRef.current =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        setPaint(shown);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const id = window.setTimeout(() => {
      lastPaintAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
      setPaint(shownRef.current);
    }, 48);
    return () => window.clearTimeout(id);
  }, [active, shown, paint.length]);

  // Settled text is a pure render projection, so completion snaps without a
  // state-setting effect or a trailing animation frame.
  const body = active ? paint : target;

  return (
    <div className={cn("min-w-0 max-w-full", className)}>
      {body.length > 0 ? (
        <AgentOsMarkdown>{body}</AgentOsMarkdown>
      ) : (
        <span className="inline-block min-h-[1.25em]" aria-hidden>
          {"\u00a0"}
        </span>
      )}
      {caret && active ? (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-0.5 animate-pulse bg-white/70 align-text-bottom motion-reduce:animate-none"
        />
      ) : null}
    </div>
  );
}
