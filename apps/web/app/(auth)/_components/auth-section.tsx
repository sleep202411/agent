"use client";

import { cn } from "@/lib/utils";

/**
 * Shared layout for auth pages — Storytale-inspired:
 *   - small square logo at the top
 *   - big bold headline
 *   - muted supporting line
 *   - form
 *   - optional footer (auxiliary link row, usually a "sign up" / "sign in"
 *     switch)
 *
 * No card chrome — the form sits on the page background so the
 * surrounding layout (imagery / marketing) can carry any visual
 * treatment without fighting this column.
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
    <div className={cn("w-full max-w-md", className)}>
      {/* Width is auto — only pin the height so the logo renders at its
          natural aspect ratio. Using a plain <img> (not next/image)
          because the source is a non-square wordmark and next/image
          requires explicit dimensions. */}
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

/** Shared input styling for the auth forms — roomy but lightly rounded. */
export const AUTH_INPUT_CLASS =
  "h-12 rounded-xl border-border/60 bg-background px-4 text-sm placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:ring-0";

/** Full-width primary submit button matching the input's corner radius. */
export const AUTH_SUBMIT_CLASS = "h-12 w-full rounded-xl text-sm font-semibold";

/**
 * Phone-number regex the auth forms use to decide whether an identifier
 * should be routed through the phone-auth endpoint instead of the email
 * one. Matches China mainland mobile numbers (11 digits starting with 1).
 */
export const CN_PHONE_PATTERN = /^1\d{10}$/;

export function isPhoneIdentifier(value: string): boolean {
  return CN_PHONE_PATTERN.test(value.trim());
}
