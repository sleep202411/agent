"use client";

import Link from "next/link";
import { IconCheck } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { localizedProjectWorkspaceHref } from "@/src/lib/studio-routes";
import { cn } from "@/lib/utils";
import { PRODUCE_STEPS } from "../_data/steps";

interface ProduceStepperProps {
  currentIndex: number;
  projectId: string;
}

/**
 * Three-state stepper:
 *   - Completed (i < currentIndex): primary fill + checkmark
 *   - Active   (i === currentIndex): primary fill + step number
 *   - Pending  (i > currentIndex): muted fill + step number
 *
 * Uses design tokens (`bg-primary`, `bg-muted`, `text-muted-foreground`)
 * so it inherits the app's palette automatically.
 */
export function ProduceStepper({ currentIndex, projectId }: ProduceStepperProps) {
  const t = useTranslations("produce");

  return (
    <nav className="flex shrink-0 items-center gap-3">
      {PRODUCE_STEPS.map((step, i) => {
        const completed = i < currentIndex;
        const active = i === currentIndex;
        return (
          <div key={step.key} className="flex items-center gap-3">
            <Link
              href={localizedProjectWorkspaceHref(projectId, {
                suffix: `/produce/${step.key}`,
              })}
              className="flex items-center gap-2"
            >
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-sm font-medium transition-colors",
                  completed
                    ? "bg-primary text-primary-foreground"
                    : active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {completed ? <IconCheck className="size-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-sm transition-colors",
                  active
                    ? "font-medium text-foreground"
                    : completed
                      ? "text-foreground"
                      : "text-muted-foreground"
                )}
              >
                {t(step.labelKey)}
              </span>
            </Link>
            {i < PRODUCE_STEPS.length - 1 && (
              <span className="text-muted-foreground/40" aria-hidden>
                ─────
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}
