"use client";

import { useEffect, useMemo, useState } from "react";
import { IconAlertCircle, IconSparkles } from "@tabler/icons-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { PlazaHero } from "@/components/layout/plaza-hero";
import { useTranslations } from "@/src/i18n/i18n";
import { useCourseList, useCourseProgressMap, useFilteredCourses } from "@/src/hooks/use-courses";
import { isCourseApiError } from "@/src/services/courses";
import { CourseList } from "./_components/CourseList";
import { SearchFilter } from "./_components/SearchFilter";

interface PageFilters {
  searchQuery: string;
  selectedCategory: string | null;
  selectedPriceRange: string | null;
}

/**
 * 渲染课程首页并管理筛选状态、视图状态和课程列表数据。
 */
export default function CoursesPage() {
  const t = useTranslations("courses");
  const { isLoading, error, outerCourses, groupedCourses } = useCourseList();
  const [filters, setFilters] = useState<PageFilters>({
    searchQuery: "",
    selectedCategory: null,
    selectedPriceRange: null,
  });
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const courseFilters = useMemo(
    () => ({
      searchQuery: filters.searchQuery,
      category: filters.selectedCategory,
      priceRange: filters.selectedPriceRange,
    }),
    [filters]
  );

  const filteredCourses = useFilteredCourses(outerCourses, courseFilters);
  const progressMap = useCourseProgressMap(groupedCourses);
  const courseListLoginError = isCourseApiError(error, 302, "Not logged in!");

  useEffect(() => {
    if (courseListLoginError) {
      toast.error(t("loginRequiredDescription"), {
        id: "course-list-not-logged-in",
      });
    }
  }, [courseListLoginError, t]);

  /**
   * 合并搜索、类别、价格等筛选条件更新。
   */
  function handleFiltersChange(updates: Partial<PageFilters>) {
    setFilters((previousFilters) => ({
      ...previousFilters,
      ...updates,
    }));
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] overflow-hidden bg-background text-foreground">
      <PlazaHero
        eyebrow={{ icon: IconSparkles, label: t("heroEyebrow"), meta: t("heroMeta") }}
        title={{ plain: t("heroTitle"), accent: t("heroTitleAccent") }}
        subtitle={t("heroDescription")}
        stats={{
          items: [{ value: outerCourses.length, label: t("courseCountSuffix") }],
          cap: t("courseCountCap"),
          dotted: true,
        }}
      />

      <div className="mx-auto grid w-full max-w-[1540px] grid-cols-1 items-start gap-6 px-5 py-8 md:px-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
        <div>
          <SearchFilter
            filters={filters}
            onFiltersChange={handleFiltersChange}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        </div>

        <div className="min-h-0">
          <div className="w-full">
            {isLoading ? (
              <div className="flex min-h-80 items-center justify-center">
                <Spinner className="size-7 text-[#ff5967]" />
              </div>
            ) : null}

            {courseListLoginError ? (
              <Alert variant="destructive" className="border-[#3a2230] bg-[#111119]">
                <IconAlertCircle />
                <AlertTitle>{t("loginRequiredTitle")}</AlertTitle>
                <AlertDescription>{t("loginRequiredDescription")}</AlertDescription>
              </Alert>
            ) : null}

            {error && !courseListLoginError ? (
              <Alert variant="destructive" className="border-[#3a2230] bg-[#111119]">
                <IconAlertCircle />
                <AlertTitle>{t("loadFailedTitle")}</AlertTitle>
                <AlertDescription>{t("loadFailedDescription")}</AlertDescription>
              </Alert>
            ) : null}

            {!isLoading && !error ? (
              <CourseList courses={filteredCourses} progressMap={progressMap} viewMode={viewMode} />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
