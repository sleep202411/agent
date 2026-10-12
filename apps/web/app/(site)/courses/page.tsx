"use client";

import { useMemo } from "react";
import { CourseLoadError } from "./_components/CourseLoadError";
import { CoursesHero } from "./_components/CoursesHero";
import { PublicCourseList } from "./_components/PublicCourseList";
import { Spinner } from "@/components/ui/spinner";
import { usePublicCourseList } from "@/src/hooks/use-courses-public";
import { PUBLIC_COURSE_TYPE } from "@/src/services/courses-public";
import { useTranslations } from "@/src/i18n/i18n";

/**
 * Academy catalog — OPC hero, then the existing course cards in a
 * contained width. Required courses scroll sideways when they overflow.
 */
export default function CoursesPage() {
  const t = useTranslations("courses");
  const { isLoading, error, courses, refetch, isFetching } = usePublicCourseList();

  const required = useMemo(
    () => courses.filter((course) => course.type === PUBLIC_COURSE_TYPE.required),
    [courses]
  );
  const skills = useMemo(
    () => courses.filter((course) => course.type === PUBLIC_COURSE_TYPE.skill),
    [courses]
  );
  const masters = useMemo(
    () => courses.filter((course) => course.type === PUBLIC_COURSE_TYPE.master),
    [courses]
  );

  const empty = !isLoading && !error && courses.length === 0;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1200px] px-5 pt-6 md:px-6 md:pt-8">
        <CoursesHero />

        {isLoading ? (
          <div className="flex min-h-48 items-center justify-center">
            <Spinner className="size-7 text-[#ea2804]" />
          </div>
        ) : null}

        {error ? (
          <div className="mt-6">
            <CourseLoadError error={error} retry={() => void refetch()} busy={isFetching} />
          </div>
        ) : null}

        {empty ? (
          <div className="mt-6">
            <PublicCourseList courses={[]} viewMode="grid" />
          </div>
        ) : null}

        {!isLoading && !error && required.length > 0 ? (
          <section className="mt-5">
            <PublicCourseList courses={required} viewMode="grid" layout="rail" />
          </section>
        ) : null}
      </div>

      {!isLoading && !error ? (
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-14 px-5 pt-12 pb-16 md:px-6 md:pt-14 md:pb-20">
          {skills.length > 0 ? (
            <section className="space-y-6">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.28em] text-[#ea2804] uppercase">
                  {t("skillsEyebrow")}
                </p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-white md:text-3xl">
                  {t("skillsTitle")}
                </h2>
              </div>
              <PublicCourseList courses={skills} viewMode="grid" />
            </section>
          ) : null}

          {masters.length > 0 ? (
            <section className="space-y-6">
              <div className="max-w-xl">
                <p className="text-[11px] font-semibold tracking-[0.28em] text-[#ea2804] uppercase">
                  {t("mastersEyebrow")}
                </p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-white md:text-3xl">
                  {t("mastersTitle")}
                </h2>
              </div>
              <PublicCourseList courses={masters} viewMode="grid" />
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
