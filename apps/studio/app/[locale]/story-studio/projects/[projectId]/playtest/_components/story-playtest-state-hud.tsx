"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { IconAdjustmentsHorizontal, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function StoryPlaytestStateHud({
  values,
  rows,
  completedEndingIds,
}: {
  values: Record<string, unknown>;
  rows: readonly { key: string; label: string; initialValue?: unknown }[];
  completedEndingIds: readonly string[];
}) {
  const t = useTranslations("storyStudio.canvas.workingPreview.stateHud");
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const formatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }),
    [locale]
  );
  const entries = rows.map((row) => {
    const value = Object.hasOwn(values, row.key) ? values[row.key] : row.initialValue;
    return { ...row, value, changed: row.initialValue !== undefined && value !== row.initialValue };
  });
  const changedCount = entries.filter((row) => row.changed).length;
  const visible = entries.filter((row) =>
    `${row.label} ${row.key}`
      .toLocaleLowerCase(locale)
      .includes(search.trim().toLocaleLowerCase(locale))
  );
  if (rows.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="pointer-events-auto gap-2 text-muted-foreground hover:text-foreground"
          aria-label={t("title")}
        >
          <IconAdjustmentsHorizontal className="size-4" />
          <span className="hidden sm:inline">{t("title")}</span>
          <span className="rounded-md bg-foreground/[0.07] px-1.5 py-0.5 text-[10px] tabular-nums">
            {rows.length}
          </span>
          {changedCount > 0 && (
            <span
              className="size-1.5 rounded-full bg-brand-blue"
              aria-label={t("changedCount", { count: changedCount })}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={12}
        className="w-[min(340px,calc(100vw-24px))] gap-0 overflow-hidden rounded-2xl p-0 shadow-[0_16px_64px_rgb(0_0_0/0.45)]"
      >
        <aside aria-label={t("title")}>
          <div className="space-y-4 px-4 pt-4 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("description")}</p>
            </div>
            {rows.length > 8 && (
              <label className="flex items-center gap-2 rounded-lg bg-input/20 px-2.5">
                <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  type="search"
                  aria-label={t("search")}
                  placeholder={t("search")}
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
                />
              </label>
            )}
          </div>
          <dl
            className="max-h-[min(50dvh,360px)] overflow-y-auto px-4 pb-3"
            aria-live="polite"
            aria-relevant="text"
          >
            {visible.map((row) => {
              const numeric = typeof row.value === "number";
              const boolean = typeof row.value === "boolean";
              const delta =
                numeric && typeof row.initialValue === "number"
                  ? (row.value as number) - row.initialValue
                  : 0;
              const formatted = boolean
                ? t(row.value ? "yes" : "no")
                : numeric
                  ? formatter.format(row.value as number)
                  : row.value == null
                    ? "—"
                    : typeof row.value === "object"
                      ? JSON.stringify(row.value)
                      : String(row.value);
              return (
                <div
                  key={row.key}
                  className="flex min-h-12 items-center justify-between gap-4 border-b border-border py-2.5 last:border-0"
                >
                  <dt className="min-w-0 break-words text-xs text-foreground/80" title={row.key}>
                    {row.label}
                  </dt>
                  <dd className="flex shrink-0 items-center gap-2 text-right">
                    {delta !== 0 && (
                      <span
                        className="text-[10px] tabular-nums text-brand-blue"
                        title={t("sinceStart")}
                      >
                        {delta > 0 ? "+" : ""}
                        {formatter.format(delta)}
                      </span>
                    )}
                    <span
                      key={formatted}
                      className={cn(
                        "max-w-36 break-words text-xs font-medium tabular-nums",
                        boolean &&
                          "inline-flex items-center gap-1.5 rounded-md bg-foreground/[0.06] px-2 py-1",
                        boolean && !row.value ? "text-muted-foreground" : "text-foreground"
                      )}
                    >
                      {boolean && (
                        <span
                          className={cn(
                            "size-1 rounded-full",
                            row.value ? "bg-foreground" : "bg-muted-foreground/40"
                          )}
                        />
                      )}
                      {formatted}
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
          {visible.length === 0 && (
            <p role="status" className="px-4 pb-5 text-xs text-muted-foreground">
              {t("noResults")}
            </p>
          )}
          {completedEndingIds.length > 0 && (
            <p className="bg-foreground/[0.03] px-4 py-3 text-[11px] text-muted-foreground">
              {t("endingCount", { count: new Set(completedEndingIds).size })}
            </p>
          )}
        </aside>
      </PopoverContent>
    </Popover>
  );
}
