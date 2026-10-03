"use client";

import { useState } from "react";
import { IconSparkles } from "@tabler/icons-react";
import { CourseLoadError } from "./_components/CourseLoadError";
import { Spinner } from "@/components/ui/spinner";
import { PlazaHero } from "@/components/layout/plaza-hero";
import { useTranslations } from "@/src/i18n/i18n";
import { usePublicCourseList } from "@/src/hooks/use-courses-public";
import { PublicCourseList } from "./_components/PublicCourseList";
import { SearchFilter } from "./_components/SearchFilter";

interface PageFilters {
  searchQuery: string;
  selectedCategory: string | null;
  selectedPriceRange: string | null;
}

/**
 * Courses plaza — public catalog from Java `/project/courses`.
 * Category / price filters stay visual-only for now (all free).
 */
export default function CoursesPage() {
  const t = useTranslations("courses");
  const [filters, setFilters] = useState<PageFilters>({
    searchQuery: "",
    selectedCategory: null,
    selectedPriceRange: null,
  });
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const { isLoading, error, courses, filteredCourses, refetch, isFetching } = usePublicCourseList(
    filters.searchQuery
  );

  function handleFiltersChange(updates: Partial<PageFilters>) {
    setFilters((previous) => ({ ...previous, ...updates }));
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] overflow-hidden bg-background text-foreground">
      <PlazaHero
        eyebrow={{ icon: IconSparkles, label: t("heroEyebrow"), meta: t("heroMeta") }}
        title={{ plain: t("heroTitle"), accent: t("heroTitleAccent") }}
        subtitle={t("heroDescription")}
        stats={{
          items: [{ value: courses.length, label: t("courseCountSuffix") }],
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

            {error ? (
              <CourseLoadError error={error} retry={() => void refetch()} busy={isFetching} />
            ) : null}

            {!isLoading && !error ? (
              <PublicCourseList courses={filteredCourses} viewMode={viewMode} />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
