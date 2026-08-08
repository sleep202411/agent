"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Smooth progressive reveal for chunky transports (poll / batched deltas).
 *
 * Wire delivers `target` in jumps (e.g. every 120ms poll). We never paint the
 * full jump at once — rAF catches up a few code units per frame so the bubble
 * feels like continuous typing instead of block pops.
 */
export function SmoothStreamText({
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
  const shownRef = useRef("");
  const targetRef = useRef(target);

  targetRef.current = target;

  // When the turn finishes, snap to full text immediately (no trailing lag).
  useEffect(() => {
    if (!active) {
      shownRef.current = target;
      setShown(target);
    }
  }, [active, target]);

  // One rAF loop for the whole streaming phase.
  useEffect(() => {
    if (!active) return;

    let raf = 0;
    const tick = () => {
      const want = targetRef.current;
      const have = shownRef.current;

      if (want !== have) {
        if (have.length > 0 && !want.startsWith(have)) {
          // Reset / replace — rare; snap.
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

  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {shown}
      {caret && active ? (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-0.5 animate-pulse bg-white/70 align-text-bottom"
        />
      ) : null}
    </span>
  );
}
