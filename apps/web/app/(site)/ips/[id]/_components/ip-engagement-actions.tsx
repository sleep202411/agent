import type { ReactNode } from "react";

export function IpEngagementActions({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2 lg:max-w-md">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
