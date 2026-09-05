"use client";

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
}

export function PublicCourseList({ courses, viewMode }: PublicCourseListProps) {
  const t = useTranslations("courses");

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

  return (
    <section
      className={cn(
        viewMode === "grid"
          ? "grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-4"
          : "flex flex-col gap-3.5"
      )}
    >
      {courses.map((course) => (
        <PublicCourseCard
          key={course.id}
          course={course}
          progress={readPublicCourseProgress(course.id)}
          variant={viewMode}
        />
      ))}
    </section>
  );
}
