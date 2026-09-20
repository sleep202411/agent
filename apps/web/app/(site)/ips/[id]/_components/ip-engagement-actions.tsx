import type { ReactNode } from "react";

/** Keep membership consequences visible with the actions that trigger them. */
export function IpEngagementActions({ children, notice }: { children: ReactNode; notice: string }) {
  return (
    <div className="min-w-0 space-y-2 lg:max-w-md">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <p className="max-w-md text-xs leading-5 text-muted-foreground">{notice}</p>
    </div>
  );
}
