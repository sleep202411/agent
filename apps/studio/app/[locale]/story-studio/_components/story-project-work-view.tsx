"use client";

import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { cn } from "@/lib/utils";

/**
 * Wraps the step page so the phone layout can hide it while the chat view is
 * active. CSS-only visibility — the page stays mounted either way, exactly
 * like the agent panel, so switching views never loses state.
 */
export function StoryProjectWorkView({ children }: { children: React.ReactNode }) {
  const mobileView = useStoryProjectUiStore((state) => state.mobileView);
  return (
    <div className={cn("flex min-w-0 flex-1", mobileView === "chat" && "max-md:hidden")}>
      {children}
    </div>
  );
}
