"use client";

import { useActiveWorkspaceId } from "@/app/_components/workspace-context";

/**
 * Remounts its subtree whenever the active workspace changes (the changed `key`
 * forces React to unmount + remount). Wrap surfaces whose internal state is
 * workspace-scoped — e.g. the image/video generation feeds, whose job list,
 * realtime subscription, and polling must reset cleanly so one workspace's
 * history never bleeds into another.
 */
export function WorkspaceRemount({ children }: { children: React.ReactNode }) {
  const workspaceId = useActiveWorkspaceId();
  return (
    <div key={workspaceId ?? "personal"} className="contents">
      {children}
    </div>
  );
}
