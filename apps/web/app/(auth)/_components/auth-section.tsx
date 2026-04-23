"use client";

import { cn } from "@/lib/utils";

/**
 * Left-column shell for the two-pane auth layout. Logo at top, big
 * headline, muted subtitle, form, aux link row. No custom input
 * styling — the inner form uses stock shadcn `Field` + `Input` +
 * `Button` so it stays in lockstep with the rest of the design system.
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
    <div className={cn("mx-auto w-full max-w-md", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="FizzDragon" className="mb-10 h-10 w-auto" />

      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {children}
      {footer ? <div className="mt-6 text-sm">{footer}</div> : null}
    </div>
  );
}

export const CN_PHONE_PATTERN = /^1\d{10}$/;

export function isPhoneIdentifier(value: string): boolean {
  return CN_PHONE_PATTERN.test(value.trim());
}
