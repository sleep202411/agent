"use client";

import { useState } from "react";
import { CourseLoadError } from "./_components/CourseLoadError";
import { Spinner } from "@/components/ui/spinner";
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
 * Price filters use community-credit sale terms from the list payload.
 */
export default function CoursesPage() {
  const [filters, setFilters] = useState<PageFilters>({
    searchQuery: "",
    selectedCategory: null,
    selectedPriceRange: null,
  });
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const { isLoading, error, filteredCourses, refetch, isFetching } = usePublicCourseList(
    filters.searchQuery,
    filters.selectedPriceRange
  );

  function handleFiltersChange(updates: Partial<PageFilters>) {
    setFilters((previous) => ({ ...previous, ...updates }));
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] overflow-hidden bg-background text-foreground">
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
