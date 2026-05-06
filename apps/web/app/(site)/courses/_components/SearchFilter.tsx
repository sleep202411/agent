"use client";

import { useState } from "react";
import { IconBox, IconClipboardText, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";

interface SearchFilterValues {
  searchQuery: string;
  selectedCategory: string | null;
  selectedPriceRange: string | null;
}

export interface SearchFilterProps {
  filters: SearchFilterValues;
  onFiltersChange: (updates: Partial<SearchFilterValues>) => void;
  viewMode: "grid" | "list";
  onViewModeChange: (viewMode: "grid" | "list") => void;
}

const CATEGORY_OPTIONS = [
  { labelKey: "allCourses", value: null },
  { labelKey: "platformTutorial", value: "0" },
  { labelKey: "aigcMasterClass", value: "1" },
] as const;

const PRICE_OPTIONS = [
  { labelKey: "allPrices", value: null },
  { labelKey: "free", value: "free" },
  { labelKey: "price0To100", value: "0-100" },
  { labelKey: "price100To300", value: "100-300" },
  { labelKey: "price300To500", value: "300-500" },
  { labelKey: "price500Plus", value: "500+" },
] as const;

/**
 * 渲染左侧筛选区域中的单个筛选面板。
 */
function FilterPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[10px] border border-[#242432] bg-[#111119] p-5">
      <h2 className="mb-4 text-xs font-bold text-[#aeb6c8]">{title}</h2>
      {children}
    </section>
  );
}

/**
 * 渲染课程首页左侧搜索、视图切换、类别和价格筛选控件。
 */
export function SearchFilter({
  filters,
  onFiltersChange,
  viewMode,
  onViewModeChange,
}: SearchFilterProps) {
  const t = useTranslations("courses");
  const [expanded, setExpanded] = useState(false);

  const panelContent = (
    <div className="space-y-4">
      <FilterPanel title={t("search")}>
        <div className="relative">
          <Input
            value={filters.searchQuery}
            placeholder={t("searchPlaceholder")}
            className="h-10 rounded-lg border-[#303041] bg-[#1d1d27] pl-4 pr-9 text-sm text-white placeholder:text-[#7f8799] focus-visible:border-[#4a4a61]"
            onChange={(event) => onFiltersChange({ searchQuery: event.target.value })}
          />
          <IconSearch className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#7f8799]" />
        </div>
      </FilterPanel>

      <FilterPanel title={t("viewSwitch")}>
        <div className="grid grid-cols-2 gap-2">
          <Button
            aria-label={t("gridView")}
            variant="outline"
            color="muted"
            className={cn(
              "h-10 rounded-lg border-[#303041] bg-[#1d1d27] text-[#aeb6c8] hover:bg-[#262634]",
              viewMode === "grid" && "border-[#7a2636] bg-[#4a1722] text-[#ffd9dd]"
            )}
            onClick={() => onViewModeChange("grid")}
          >
            <IconBox className="size-4" />
          </Button>
          <Button
            aria-label={t("listView")}
            variant="outline"
            color="muted"
            className={cn(
              "h-10 rounded-lg border-[#303041] bg-[#1d1d27] text-[#aeb6c8] hover:bg-[#262634]",
              viewMode === "list" && "border-[#7a2636] bg-[#4a1722] text-[#ffd9dd]"
            )}
            onClick={() => onViewModeChange("list")}
          >
            <IconClipboardText className="size-4" />
          </Button>
        </div>
      </FilterPanel>

      <FilterPanel title={t("category")}>
        <div className="space-y-2">
          {CATEGORY_OPTIONS.map((option) => (
            <button
              key={option.value ?? "all"}
              type="button"
              className={cn(
                "flex h-9 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-semibold text-white transition-colors hover:bg-[#1d1d27]",
                filters.selectedCategory === option.value && "bg-[#3b141d] text-[#ff5967]"
              )}
              onClick={() => onFiltersChange({ selectedCategory: option.value })}
            >
              <span>{t(option.labelKey)}</span>
            </button>
          ))}
        </div>
      </FilterPanel>

      <FilterPanel title={t("priceRange")}>
        <div className="space-y-2">
          {PRICE_OPTIONS.map((option) => (
            <button
              key={option.value ?? "all"}
              type="button"
              className={cn(
                "flex h-9 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-white transition-colors hover:bg-[#1d1d27]",
                filters.selectedPriceRange === option.value && "bg-[#3b141d] text-[#ff5967]"
              )}
              onClick={() => onFiltersChange({ selectedPriceRange: option.value })}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </FilterPanel>
    </div>
  );

  return (
    <aside className="w-full lg:w-[280px]">
      <div className="lg:hidden">
        <Button
          variant="outline"
          color="muted"
          className="mb-3 h-10 w-full justify-between border-[#303041] bg-[#111119] text-white"
          onClick={() => setExpanded((value) => !value)}
        >
          {t("filters")}
          <span className="text-xs text-[#aeb6c8]">{expanded ? t("collapse") : t("expand")}</span>
        </Button>
      </div>
      <div className={cn("lg:block", expanded ? "block" : "hidden")}>{panelContent}</div>
    </aside>
  );
}
