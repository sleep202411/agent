"use client";

import Link from "next/link";
import { IconCalendar, IconClock, IconArrowRight } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import type { OpenJob } from "@/app/(site)/crews/_hooks/use-crew";

export function JobCard({ job }: { job: OpenJob }) {
  const t = useTranslations("crew");

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/[0.04]">
      {/* Cover w/ role title overlay */}
      <Link
        href={`/crews/${job.crewId}`}
        className="relative block aspect-[16/9] overflow-hidden bg-secondary"
      >
        {job.crewCover ? (
          <img
            src={job.crewCover}
            alt={job.crewName}
            className="size-full object-cover opacity-60 transition-all duration-500 group-hover:scale-105 group-hover:opacity-80"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/15 to-accent/10">
            <span className="text-3xl font-black text-foreground/10">{job.roleName[0]}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="text-[10px] font-medium uppercase tracking-widest text-white/60">
            {job.crewName}
          </div>
          <h3 className="mt-1 line-clamp-1 text-xl font-bold leading-tight text-white">
            {job.roleName}
          </h3>
        </div>
      </Link>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Budget + period strip */}
        <div className="flex items-center justify-between text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("budgetLabel")}
            </div>
            <div className="mt-0.5 text-base font-bold text-accent">{job.budget}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("periodLabel")}
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
              <IconClock className="size-3.5" /> {job.period}
            </div>
          </div>
        </div>

        {/* Skills */}
        {job.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {job.skills.map((s) => (
              <span
                key={s}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-foreground/80"
              >
                {s}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/5 pt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <IconCalendar className="size-3.5" /> {job.deadline}
          </span>
          <Link
            href={`/crews/${job.crewId}`}
            className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-black transition-transform hover:scale-105"
          >
            {t("applyNow")} <IconArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
