"use client";

import { useCallback, useEffect, useRef } from "react";
import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/** How close to the bottom (px) counts as "read to the end". */
const SCROLL_END_EPSILON = 12;

export interface ConsentSection {
  key: string;
  title: string;
  body: string;
}

/**
 * Versioned consent-screen primitive — a scrollable block of mandatory clauses
 * gated behind (1) scroll-to-end and (2) an 18+ attestation checkbox. The
 * rendered copy IS the consented text for its version string; the accept
 * affordance lives in the parent, which reads `read` + `attested`.
 *
 * Shared by the enrollment consent (account-level) and the per-project grant
 * consent (subject "Authorize a project" + actor casting accept).
 */
export function ConsentScreen({
  versionLabel,
  sections,
  attestationLabel,
  scrollHint,
  read,
  onRead,
  attested,
  onAttestedChange,
  disabled,
}: {
  versionLabel: string;
  sections: ConsentSection[];
  attestationLabel: string;
  scrollHint: string;
  /** User has scrolled the copy to the end (latched — never un-reads). */
  read: boolean;
  onRead: () => void;
  attested: boolean;
  onAttestedChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const checkEnd = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_END_EPSILON) onRead();
  }, [onRead]);

  // A viewport tall enough to show everything means there is nothing to
  // scroll — the gate is satisfied on mount (and on resize).
  useEffect(() => {
    checkEnd();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(checkEnd);
    observer.observe(el);
    return () => observer.disconnect();
  }, [checkEnd]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl bg-white/[0.03]">
        <div
          ref={scrollRef}
          onScroll={checkEnd}
          className="max-h-[40vh] overflow-y-auto px-4 py-4"
          data-testid="consent-copy"
        >
          <span className="inline-block rounded-full bg-white/[0.07] px-2 py-0.5 font-mono text-[10px] text-white/60">
            {versionLabel}
          </span>
          <div className="mt-3 space-y-4">
            {sections.map((section) => (
              <section key={section.key}>
                <h3 className="text-[13px] font-medium text-foreground">{section.title}</h3>
                <p className="mt-1 text-xs/relaxed text-muted-foreground">{section.body}</p>
              </section>
            ))}
          </div>
        </div>

        {/* More-below affordance: fade + hint until the copy is read through. */}
        {!read && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center bg-gradient-to-t from-popover to-transparent pt-10 pb-2">
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-medium text-white/80 backdrop-blur-xl">
              {scrollHint}
            </span>
          </div>
        )}
      </div>

      {/* Adult attestation — required alongside the scroll-through gate. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={attested}
        disabled={disabled}
        onClick={() => onAttestedChange(!attested)}
        className="flex w-full items-start gap-2.5 rounded-xl bg-white/[0.04] px-3.5 py-3 text-left transition-colors hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-60"
      >
        <span
          aria-hidden
          className={cn(
            "mt-px grid size-4.5 shrink-0 place-items-center rounded-md transition-colors",
            attested ? "bg-primary text-primary-foreground" : "bg-input/30"
          )}
        >
          {attested && <IconCheck className="size-3" stroke={3} />}
        </span>
        <span className="text-xs/relaxed font-medium text-foreground">{attestationLabel}</span>
      </button>
    </div>
  );
}
