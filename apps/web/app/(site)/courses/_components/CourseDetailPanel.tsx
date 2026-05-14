"use client";

import Link from "next/link";
import { IconArrowBackUp } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import type { CourseDetailData } from "@/src/hooks/use-courses";

interface CourseDetailPanelProps {
  courseDetail: CourseDetailData;
  onEpisodeSelect: (episodeID: number) => void;
}

function formatUpdateTime(updateTime: string, locale: string) {
  if (!updateTime) return "";

  const date = new Date(updateTime);
  if (Number.isNaN(date.getTime())) return updateTime;

  return date.toLocaleDateString(locale);
}

export function CourseDetailPanel({ courseDetail, onEpisodeSelect }: CourseDetailPanelProps) {
  const t = useTranslations("courses");
  const locale = useLocale() as Locale;
  const { detail, series, currentId } = courseDetail;

  return (
    // Mobile (<lg): flows under the sticky video and scrolls with the
    // page — no internal scroll, no fixed height. A top border replaces
    // the desktop left border so the seam between video and panel reads.
    // Desktop (lg+): stays a fixed-width column with its own internal
    // scroll for the playlist (mirrors YouTube / Bilibili PC chrome).
    <aside className="flex w-full flex-col border-t border-[#171722] bg-[#07070c] px-6 py-7 text-white lg:h-full lg:min-h-0 lg:w-[360px] lg:border-t-0 lg:border-l xl:w-[400px]">
      <div className="border-b border-[#1d1d29] pb-6">
        <Link
          href={localizePath("/courses", locale)}
          className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[#aeb6c8] transition-colors hover:text-white"
        >
          <IconArrowBackUp className="size-4" />
          <span>{t("backToCourses")}</span>
        </Link>
        <h1 className="text-xl font-bold leading-snug">{detail.title}</h1>
        <p className="mt-4 text-sm leading-6 text-[#aeb6c8]">{detail.info}</p>

        {detail.updateTime ? (
          <p className="mt-4 text-xs text-[#6f7585]">
            {formatUpdateTime(detail.updateTime, locale)}
          </p>
        ) : null}
      </div>

      <div className="mt-6 flex flex-col lg:min-h-0 lg:flex-1">
        <h2 className="text-base font-bold">{t("courseDirectory")}</h2>
        <div className="mt-4 pr-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="space-y-2">
            {series.map((course, index) => {
              const active = course.id === currentId;

              return (
                <Link
                  key={course.id}
                  href={localizePath(`/courses/${detail.mainID}`, locale)}
                  onClick={() => onEpisodeSelect(course.id)}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-lg border border-transparent bg-[#111119] px-3 py-2 transition-colors hover:border-[#3a3a4d]",
                    active && "border-[#6f222d] bg-[#3b141d] text-[#ff5967]"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full bg-[#252837] text-xs font-bold text-[#aeb6c8]",
                      active && "bg-[#f0444c] text-white"
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="line-clamp-2 text-sm font-semibold">{course.title}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
