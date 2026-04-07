"use client";

import { IconSearch, IconUsers, IconBriefcase, IconMovie, IconTrophy } from "@tabler/icons-react";
import { MOCK_STATS, MOCK_HOT_SKILLS } from "./creators-mock";

const stats = [
  { icon: IconUsers, label: "Active Creators", value: MOCK_STATS.activeCreators, suffix: "+" },
  { icon: IconBriefcase, label: "Open Roles", value: MOCK_STATS.openRoles, suffix: "+" },
  { icon: IconMovie, label: "Active Studios", value: MOCK_STATS.activeStudios, suffix: "+" },
  { icon: IconTrophy, label: "Projects Done", value: MOCK_STATS.completedProjects, suffix: "" },
];

interface CreatorsHeroProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onSkillClick: (skill: string) => void;
}

export function CreatorsHero({ searchTerm, onSearchChange, onSkillClick }: CreatorsHeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-border">
      {/* Background glows */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/4 top-0 h-[500px] w-[500px] rounded-full bg-primary/[0.06] blur-3xl" />
        <div className="absolute right-1/4 top-1/4 h-[400px] w-[400px] rounded-full bg-violet-500/[0.04] blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-[300px] w-[600px] -translate-x-1/2 rounded-full bg-amber-500/[0.03] blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-screen-2xl px-6 pb-10 pt-16">
        <div className="text-center">
          <h1 className="text-4xl font-black tracking-tight md:text-5xl">
            <span className="text-foreground">Creator</span>{" "}
            <span className="bg-gradient-to-r from-primary via-violet-400 to-amber-400 bg-clip-text text-transparent">
              Square
            </span>
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
            Discover talented creators, build your dream team, and bring stories to life together.
          </p>
        </div>

        {/* Search */}
        <div className="mx-auto mt-8 max-w-xl">
          <div className="group relative">
            <IconSearch className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <input
              type="text"
              placeholder="Search creators, skills, or keywords..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] py-3.5 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground backdrop-blur-xl transition-all focus:border-primary/40 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <span className="text-[11px] text-muted-foreground">Trending:</span>
            {MOCK_HOT_SKILLS.map((skill) => (
              <button
                key={skill}
                type="button"
                onClick={() => onSkillClick(skill)}
                className="rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] text-muted-foreground transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
              >
                {skill}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map(({ icon: Icon, label, value, suffix }) => (
            <div
              key={label}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-center backdrop-blur-sm"
            >
              <Icon className="mx-auto size-5 text-primary/70" />
              <div className="mt-2 text-2xl font-black text-foreground">
                {value.toLocaleString()}
                {suffix}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
