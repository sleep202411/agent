import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Full-area host for transient project-step states such as loading and error.
 *
 * The project layout already owns the viewport, header, rail, side dock and
 * FizzAgent column. A child state must fill only the remaining work cell — it
 * must never size itself against the viewport (`h-screen`) or its text width.
 */
export function StoryProjectWorkState({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      data-slot="story-project-work-state"
      className={cn(
        "grid size-full min-h-0 min-w-0 place-items-center overflow-hidden bg-[var(--canvas-background)] text-white",
        className
      )}
    >
      {children}
    </main>
  );
}
