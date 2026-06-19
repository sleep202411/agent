import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The standard surface/section heading per DESIGN.md (§3.5): a 22px semibold
 * tracking-tight title, an optional muted subtitle, and an optional right-aligned
 * action. Single source for page headers (`as="h1"`) and in-page section headers
 * (`as="h2"`, default) so we stop hand-rolling `h1 text-xl`.
 */
export function SectionHeading({
  title,
  subtitle,
  action,
  as: As = "h2",
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <div className="min-w-0">
        <As className="text-[22px] font-semibold tracking-tight">{title}</As>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
