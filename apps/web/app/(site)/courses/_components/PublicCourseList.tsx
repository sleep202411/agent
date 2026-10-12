"use client";

import { useEffect, useState } from "react";
import { IconSearchOff } from "@tabler/icons-react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import type { PublicCourseCardModel } from "@/src/hooks/use-courses-public";
import { readPublicCourseProgress } from "@/src/hooks/use-courses-public";
import { PublicCourseCard } from "./PublicCourseCard";

export interface PublicCourseListProps {
  courses: PublicCourseCardModel[];
  viewMode: "grid" | "list";
  /** Horizontal rail for required courses — no wrap. */
  layout?: "grid" | "rail";
}

export function PublicCourseList({ courses, viewMode, layout = "grid" }: PublicCourseListProps) {
  const t = useTranslations("courses");
  const [progressTick, setProgressTick] = useState(0);

  useEffect(() => {
    const bump = () => setProgressTick((value) => value + 1);
    bump();
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", bump);
    return () => {
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", bump);
    };
  }, []);

  if (courses.length === 0) {
    return (
      <Empty className="min-h-80 border border-dashed border-[#2a2a39] bg-[#111119]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconSearchOff />
          </EmptyMedia>
          <EmptyTitle className="text-white">{t("empty")}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  const cards = courses.map((course) => (
    <PublicCourseCard
      key={course.id}
      course={course}
      progress={progressTick >= 0 ? readPublicCourseProgress(course.id, course.episodeCount) : 0}
      variant={viewMode}
    />
  ));

  if (layout === "rail") {
    return (
      <div className="-mx-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
        <div className="flex min-w-full snap-x snap-mandatory gap-4 px-1">
          {courses.map((course) => (
            <div
              key={course.id}
              className="w-[min(100%,320px)] min-w-[260px] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)]"
            >
              <PublicCourseCard
                course={course}
                progress={
                  progressTick >= 0 ? readPublicCourseProgress(course.id, course.episodeCount) : 0
                }
                variant="grid"
                compact
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section
      className={cn(
        viewMode === "grid"
          ? "grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4"
          : "flex flex-col gap-3.5"
      )}
    >
      {cards}
    </section>
  );
}
