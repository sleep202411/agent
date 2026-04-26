"use client";

import { useEffect, useState } from "react";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  // Hide the workspace chrome (top header + sidebar) when /studio is
  // embedded inside an iframe — the embedding host provides its own shell.
  const [isInIframe, setIsInIframe] = useState(false);
  useEffect(() => {
    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      // Cross-origin frame access throws — treat as iframe.
      setIsInIframe(true);
    }
  }, []);

  if (isInIframe) {
    return (
      <div className="flex h-screen flex-col overflow-hidden">
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <WorkspaceSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <WorkspaceHeader />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
