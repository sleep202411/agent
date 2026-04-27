"use client";

import { IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  SKILL_OPTIONS,
  LEVEL_OPTIONS,
  SORT_OPTIONS,
  type Creator,
} from "@/app/(site)/creators/_hooks/use-creator";
import { CreatorsTalentCard } from "./creators-talent-card";
import { cn } from "@/lib/utils";

interface CreatorsTalentGridProps {
  creators: Creator[];
  isLoading?: boolean;
  selectedSkill: string;
  onSkillChange: (skill: string) => void;
  selectedLevel: string;
  onLevelChange: (level: string) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
  onClear: () => void;
}

export function CreatorsTalentGrid({
  creators,
  isLoading,
  selectedSkill,
  onSkillChange,
  selectedLevel,
  onLevelChange,
  sortBy,
  onSortChange,
  onClear,
}: CreatorsTalentGridProps) {
  const t = useTranslations("creator");

  return (
    <section id="talent-grid">
      <div className="mx-auto max-w-screen-2xl px-6 py-10">
        {/* Skill pills */}
        <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground lg:w-16">
            {t("filterSkill")}
          </span>
          <div className="flex flex-wrap gap-2">
            {SKILL_OPTIONS.map((skill) => {
              const active = selectedSkill === skill;
              const display = skill === "All Skills" ? t("allSkills") : skill;
              return (
                <button
                  key={skill}
                  type="button"
                  onClick={() => onSkillChange(skill)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all",
                    active
                      ? "border-white/15 bg-white text-black shadow-sm"
                      : "border-white/10 bg-white/[0.04] text-muted-foreground backdrop-blur-md hover:border-white/20 hover:bg-white/[0.07] hover:text-foreground"
                  )}
                >
                  {display}
                </button>
              );
            })}
          </div>
        </div>

        {/* Level + Sort + Count */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("filterLevel")}
            </span>
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-0.5 backdrop-blur-md">
              {LEVEL_OPTIONS.map((l) => {
                const active = selectedLevel === l;
                const display = l === "All Levels" ? t("allLevels") : l;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => onLevelChange(l)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                      active ? "bg-white text-black" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {display}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {t("totalCreators", { count: creators.length })}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("sortBy")}
              </span>
              <select
                value={sortBy}
                onChange={(e) => onSortChange(e.target.value)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-foreground backdrop-blur-md focus:border-white/25 focus:outline-none"
              >
                {SORT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value} className="bg-background">
                    {s.value === "rating"
                      ? t("sortRating")
                      : s.value === "projects"
                        ? t("sortProjects")
                        : t("sortRecent")}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-x-4 gap-y-8 pt-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="mt-8 h-56 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]"
              />
            ))}
          </div>
        ) : creators.length > 0 ? (
          <div className="grid grid-cols-1 gap-x-4 gap-y-8 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {creators.map((creator) => (
              <CreatorsTalentCard key={creator.id} creator={creator} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] py-20 text-center text-muted-foreground">
            <IconSparkles className="size-10 opacity-30" />
            <p className="text-sm">{t("noResults")}</p>
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-primary hover:underline"
            >
              {t("clearFilters")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
