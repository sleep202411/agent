"use client";

import { IconBook2, IconMovie, IconPhoto } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { StoryProductionSteps } from "./story-production-steps";

const STEP_META = {
  script: { icon: IconBook2, ns: "scriptPage" },
  assets: { icon: IconPhoto, ns: "assetsPage" },
  storyboard: { icon: IconMovie, ns: "storyboardPage" },
} as const;

/**
 * Empty scaffold shared by the production steps that have no real view yet.
 * Each gets the occupying header with the stepper and an honest empty state;
 * the real views land with the pipeline, one step at a time.
 */
export function StoryStepEmptyPage({
  projectId,
  step,
}: {
  projectId: string;
  step: keyof typeof STEP_META;
}) {
  const meta = STEP_META[step];
  const t = useTranslations(`storyStudio.${meta.ns}`);
  const stepsT = useTranslations("storyStudio.canvas.steps");
  const Icon = meta.icon;
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <header className="relative z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-[oklch(0.185_0_0)] px-4">
        <h1 className="max-w-[320px] truncate text-[15px] font-semibold tracking-[-0.01em]">
          {stepsT(step)}
        </h1>
        <StoryProductionSteps
          projectId={projectId}
          active={step}
          className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:flex"
        />
        <span aria-hidden="true" />
      </header>
      <div className="grid flex-1 place-items-center px-6">
        <FrostedPanel className="flex max-w-md flex-col items-center px-8 py-10 text-center">
          <Icon className="size-6 text-white/42" stroke={1.6} />
          <h2 className="mt-4 text-sm font-semibold text-white">{t("emptyTitle")}</h2>
          <p className="mt-2 text-xs leading-5 text-white/42">{t("emptyBody")}</p>
        </FrostedPanel>
      </div>
    </main>
  );
}
