"use client";

import { cn } from "@/lib/utils";

/**
 * Shared shell for login / register / forgot-password pages. No card
 * chrome — just a width constraint + "title / subtitle / form /
 * footer-link" vertical rhythm. The surrounding layout (imagery /
 * branding) is the responsibility of AuthLayout and can stay empty
 * while we iterate.
 */
export function AuthSection({
  title,
  subtitle,
  children,
  footer,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full max-w-sm", className)}>
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
      {footer ? <div className="mt-8 text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}
