"use client";

import { IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import type { Creator } from "@/app/(site)/creators/_hooks/use-creator";
import { CreatorsTalentCard } from "./creators-talent-card";

interface CreatorsTalentGridProps {
  creators: Creator[];
  isLoading?: boolean;
}

export function CreatorsTalentGrid({ creators, isLoading }: CreatorsTalentGridProps) {
  const t = useTranslations("creator");
  const safeList = Array.isArray(creators) ? creators.filter((c) => !!c?.id) : [];

  if (isLoading) {
    return (
      <section>
        <div className="mx-auto grid max-w-screen-2xl grid-cols-1 gap-4 px-6 py-10 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]"
            />
          ))}
        </div>
      </section>
    );
  }

  if (safeList.length === 0) {
    return (
      <section>
        <div className="mx-auto max-w-screen-2xl px-6 py-10">
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] py-20 text-center text-muted-foreground">
            <IconSparkles className="size-10 opacity-30" />
            <p className="text-sm">{t("emptyOpen")}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="mx-auto grid max-w-screen-2xl grid-cols-1 gap-x-4 gap-y-10 px-6 py-10 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {safeList.map((creator, i) => (
          <div
            key={creator.id}
            className="flex animate-in fade-in slide-in-from-bottom-1 duration-500"
            style={{ animationDelay: `${Math.min(i * 30, 300)}ms`, animationFillMode: "both" }}
          >
            <CreatorsTalentCard creator={creator} />
          </div>
        ))}
      </div>
    </section>
  );
}
