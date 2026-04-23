"use client";

import { cn } from "@/lib/utils";

/**
 * Shared shell for login / register / forgot-password cards. Fixed
 * width on desktop, full-width on mobile, handles the "title +
 * subtitle" header pattern and the "footer link row" pattern all
 * three pages share. Right-side imagery / marketing panel lives in
 * AuthLayout and is TODO for now.
 */
export function AuthCard({
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
    <div
      className={cn(
        "w-full max-w-sm rounded-2xl border border-border/40 bg-card/70 p-6 shadow-lg backdrop-blur-sm sm:p-8",
        className
      )}
    >
      <div className="mb-6 space-y-1.5">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
      {footer ? (
        <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
      ) : null}
    </div>
  );
}
