"use client";

import { useEffect, useMemo, useState } from "react";
import { IconAlertCircle, IconSparkles } from "@tabler/icons-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
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

function CoursesHero({ total }: { total: number }) {
  const t = useTranslations("courses");

  return (
    <section className="relative overflow-hidden border-b border-border">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 50% 50% at 20% 30%, hsl(42 95% 55% / 0.08) 0%, transparent 60%), radial-gradient(ellipse 40% 40% at 80% 60%, hsl(280 60% 55% / 0.06) 0%, transparent 60%)",
        }}
      />

      <div className="relative mx-auto max-w-screen-2xl px-6 pb-12 pt-16">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-400">
            <IconSparkles className="size-4" />
            {t("heroEyebrow")}
            <span className="text-muted-foreground/60">/</span>
            <span className="text-muted-foreground">{t("heroMeta")}</span>
          </div>

          <h1 className="mt-4 text-4xl font-black leading-[1.1] tracking-tight text-foreground md:text-5xl">
            {t("heroTitle")}
            <br />
            <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
              {t("heroTitleAccent")}
            </span>
          </h1>

          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
            {t("heroDescription")}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-amber-400" />
              <strong className="text-foreground">{total}</strong>
              <span>{t("courseCountSuffix")}</span>
            </div>
            <span className="text-xs text-muted-foreground/70">{t("courseCountCap")}</span>
          </div>
        </div>
      </div>
    </section>
  );
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
      <CoursesHero total={outerCourses.length} />

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
