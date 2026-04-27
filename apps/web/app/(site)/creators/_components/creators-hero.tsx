"use client";

import { IconSearch, IconUsers, IconBriefcase, IconMovie, IconTrophy } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { useCreatorStats, MOCK_HOT_SKILLS } from "@/app/(site)/creators/_hooks/use-creator";

interface CreatorsHeroProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onSkillClick: (skill: string) => void;
}

export function CreatorsHero({ searchTerm, onSearchChange, onSkillClick }: CreatorsHeroProps) {
  const t = useTranslations("creator");
  const { data: stats } = useCreatorStats();

  const statCards = [
    { icon: IconUsers, labelKey: "statCreators", value: stats?.activeCreators ?? 0, suffix: "+" },
    { icon: IconBriefcase, labelKey: "statRoles", value: stats?.openRoles ?? 0, suffix: "+" },
    { icon: IconMovie, labelKey: "statStudios", value: stats?.activeStudios ?? 0, suffix: "+" },
    {
      icon: IconTrophy,
      labelKey: "statCompleted",
      value: stats?.completedProjects ?? 0,
      suffix: "",
    },
  ];

  return (
    <section className="relative overflow-hidden">
      {/* Background glows */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/4 top-0 h-[500px] w-[500px] rounded-full bg-primary/[0.06] blur-3xl" />
        <div className="absolute right-1/4 top-1/4 h-[400px] w-[400px] rounded-full bg-violet-500/[0.05] blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-[300px] w-[600px] -translate-x-1/2 rounded-full bg-amber-500/[0.04] blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-screen-2xl px-6 pb-12 pt-16">
        {/* Eyebrow */}
        <div className="mb-3 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
          <IconUsers className="size-4" /> {t("plaza")}
        </div>

        <div className="text-center">
          <h1 className="text-4xl font-black tracking-tight text-foreground md:text-5xl">
            {t("heroTitle")}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {t("heroSubtitle")}
          </p>
        </div>

        {/* Search */}
        <div className="mx-auto mt-8 max-w-xl">
          <div className="group relative">
            <IconSearch className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-foreground" />
            <input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] py-3.5 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground backdrop-blur-xl transition-all focus:border-white/25 focus:bg-white/[0.07] focus:outline-none"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("hotSkills")}
            </span>
            {MOCK_HOT_SKILLS.map((skill) => (
              <button
                key={skill}
                type="button"
                onClick={() => onSkillClick(skill)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-foreground/70 backdrop-blur-md transition-all hover:border-white/25 hover:bg-white/[0.08] hover:text-foreground"
              >
                {skill}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="mx-auto mt-12 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
          {statCards.map(({ icon: Icon, labelKey, value, suffix }) => (
            <div
              key={labelKey}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center backdrop-blur-md"
            >
              <Icon className="mx-auto size-5 text-foreground/60" />
              <div className="mt-2 text-2xl font-black text-foreground">
                {value.toLocaleString()}
                {suffix}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {t(labelKey)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
