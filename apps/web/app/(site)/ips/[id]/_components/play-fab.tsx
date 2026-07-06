"use client";

import { useEffect, useState } from "react";
import { IconPlayerPlayFilled } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/**
 * Scroll-triggered circular play FAB — slides up from the bottom once the reader
 * scrolls past the in-page CTA, keeping "play" always one tap away. Duolingo
 * language: solid orange disc, hard 3D edge, press-down.
 */
export function PlayFab({ onClick, label }: { onClick: () => void; label: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 360);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      aria-hidden={!show}
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(1.5rem,env(safe-area-inset-bottom))] transition-all duration-300 ease-out",
        show ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        tabIndex={show ? 0 : -1}
        className={cn(
          "pointer-events-auto grid size-16 place-items-center rounded-full bg-[#ea2804] text-white",
          "shadow-[0_6px_0_#b31d00,0_16px_36px_-8px_rgba(234,40,4,0.6)]",
          "transition-[transform,box-shadow,filter] duration-100 hover:brightness-105",
          "active:translate-y-1.5 active:shadow-[0_0_0_#b31d00,0_8px_20px_-8px_rgba(234,40,4,0.5)]",
          "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
        )}
      >
        <IconPlayerPlayFilled className="size-7 translate-x-0.5" />
      </button>
    </div>
  );
}
