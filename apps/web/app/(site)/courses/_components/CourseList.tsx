"use client";

import { IconSearchOff } from "@tabler/icons-react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import type { CourseProgressMap, OuterCourse } from "@/src/hooks/use-courses";
import { CourseCard } from "./CourseCard";

export interface CourseListProps {
  courses: OuterCourse[];
  progressMap: CourseProgressMap;
  viewMode: "grid" | "list";
}

/**
 * 渲染筛选后的课程列表，并根据视图模式切换网格或列表布局。
 */
export function CourseList({ courses, progressMap, viewMode }: CourseListProps) {
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
          ? "grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4"
          : "flex flex-col gap-3.5"
      )}
    >
      {courses.map((course) => (
        <CourseCard
          key={`${course.outerType}-${course.type}`}
          course={course}
          progress={progressMap[course.index] ?? 0}
          variant={viewMode}
        />
      ))}
    </section>
  );
}
