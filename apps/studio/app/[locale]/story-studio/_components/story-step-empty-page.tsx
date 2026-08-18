"use client";

import { IconMovie, IconPhoto } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { FrostedPanel } from "@/components/ui/frosted-panel";

const STEP_META = {
  assets: { icon: IconPhoto, ns: "assetsPage" },
  storyboard: { icon: IconMovie, ns: "storyboardPage" },
} as const;

/**
 * Empty scaffold shared by the production steps that have no real view yet —
 * an honest empty state under the project chrome. The real views land with
 * the pipeline, one step at a time.
 */
export function StoryStepEmptyPage({ step }: { step: keyof typeof STEP_META }) {
  const meta = STEP_META[step];
  const t = useTranslations(`storyStudio.${meta.ns}`);
  const Icon = meta.icon;
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
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
