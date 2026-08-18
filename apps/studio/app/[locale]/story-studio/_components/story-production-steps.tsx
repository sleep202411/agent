"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type LiveStep = "script" | "tree" | "assets" | "storyboard";

const STEPS: Array<{
  key: LiveStep;
  href?: (projectId: string) => string;
}> = [
  { key: "script", href: (id) => `/story-studio/projects/${id}/script` },
  { key: "tree", href: (id) => `/story-studio/projects/${id}/canvas` },
  { key: "assets", href: (id) => `/story-studio/projects/${id}/assets` },
  { key: "storyboard", href: (id) => `/story-studio/projects/${id}/storyboard` },
];

/**
 * Numbered production stepper shared by every step surface (canvas header,
 * script page). The active step is solid white; steps without a real page
 * render disabled.
 */
export function StoryProductionSteps({
  projectId,
  active,
  className,
}: {
  projectId: string;
  active: LiveStep;
  className?: string;
}) {
  const t = useTranslations("storyStudio.canvas.steps");
  return (
    <nav aria-label={t(active)} className={cn("items-center", className)}>
      {STEPS.map((step, index) => {
        const isActive = step.key === active;
        const href = step.href;
        return (
          <span key={step.key} className="inline-flex items-center">
            {index > 0 ? <span aria-hidden="true" className="mx-3 h-px w-8 bg-white/12" /> : null}
            {isActive ? (
              <span aria-current="page" className="inline-flex items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-white text-[10px] font-semibold tabular-nums text-black">
                  {index + 1}
                </span>
                <span className="text-xs font-semibold text-white">{t(step.key)}</span>
              </span>
            ) : !href ? (
              <span aria-disabled="true" className="inline-flex items-center gap-2 opacity-45">
                <span className="grid size-5 place-items-center rounded-full bg-white/10 text-[10px] font-semibold tabular-nums text-white/55">
                  {index + 1}
                </span>
                <span className="text-xs font-medium text-white/55">{t(step.key)}</span>
              </span>
            ) : (
              <Link href={href(projectId)} className="group inline-flex items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-white/10 text-[10px] font-semibold tabular-nums text-white/55 transition group-hover:bg-white/16 group-hover:text-white/85">
                  {index + 1}
                </span>
                <span className="text-xs font-medium text-white/55 transition group-hover:text-white/85">
                  {t(step.key)}
                </span>
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
