"use client";

import { useState } from "react";
import Link from "next/link";
import {
  IconChevronDown,
  IconDeviceTv,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconRefresh,
  IconVideo,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { cn } from "@/lib/utils";
import type { TvItem } from "../_hooks/types";
import styles from "./tv-ip-list.module.css";

interface TvIpListProps {
  embedded: boolean;
  items: TvItem[];
  selectedId: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onSelect: (id: string) => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

export function TvIpList({
  embedded,
  items,
  selectedId,
  isPlaying,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  onSelect,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: TvIpListProps) {
  const t = useTranslations("tv");
  const locale = useLocale() as Locale;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const detailsClass = cn(mobileOpen ? "block" : "hidden", collapsed ? "md:hidden" : "md:block");
  const toggleClass =
    "flex size-11 shrink-0 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:size-9";

  return (
    <aside
      aria-label={t("listTitle")}
      className={cn("relative z-30 h-full w-[72px] shrink-0", !collapsed && "md:w-[280px]")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && mobileOpen) {
          event.stopPropagation();
          setMobileOpen(false);
        }
      }}
    >
      {mobileOpen && (
        <button
          type="button"
          aria-label={t("collapseList")}
          onClick={() => setMobileOpen(false)}
          className="absolute inset-y-0 left-[280px] w-screen bg-black/60 md:hidden"
        />
      )}
      <div
        className={cn(
          "relative flex h-full flex-col border-r border-white/[0.06] bg-[#0c0e13]",
          mobileOpen ? "w-[280px] md:w-full" : "w-full"
        )}
      >
        <header
          className={cn(
            "flex h-[52px] shrink-0 items-center gap-3 border-b border-white/[0.06] px-3",
            mobileOpen ? "justify-between px-4" : "justify-center",
            collapsed ? "md:justify-center" : "md:justify-between"
          )}
        >
          {embedded ? (
            <span className={cn("text-sm font-semibold text-white", detailsClass)}>
              {t("listTitle")}
            </span>
          ) : (
            <Link
              href={localizePath("/ips", locale)}
              className={cn(
                "min-w-0 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
                detailsClass
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="FizzDragon"
                width={439}
                height={78}
                className="h-auto w-[142px]"
              />
            </Link>
          )}
          <button
            type="button"
            aria-label={collapsed ? t("expandList") : t("collapseList")}
            aria-expanded={!collapsed}
            aria-controls="tv-ip-list"
            onClick={() => setCollapsed((value) => !value)}
            className={cn(toggleClass, "hidden md:flex")}
          >
            {collapsed ? (
              <IconLayoutSidebarLeftExpand className="size-[18px]" />
            ) : (
              <IconLayoutSidebarLeftCollapse className="size-[18px]" />
            )}
          </button>
          <button
            type="button"
            aria-label={mobileOpen ? t("collapseList") : t("expandList")}
            aria-expanded={mobileOpen}
            aria-controls="tv-ip-list"
            onClick={() => setMobileOpen((value) => !value)}
            className={cn(toggleClass, "md:hidden")}
          >
            {mobileOpen ? (
              <IconLayoutSidebarLeftCollapse className="size-[18px]" />
            ) : (
              <IconLayoutSidebarLeftExpand className="size-[18px]" />
            )}
          </button>
        </header>

        <nav
          id="tv-ip-list"
          data-lenis-prevent
          aria-label={t("listTitle")}
          className={cn(
            "min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain py-3 [scrollbar-width:thin]",
            mobileOpen ? "px-3" : "px-2",
            collapsed ? "md:px-2" : "md:px-3"
          )}
        >
          {isLoading && (
            <p role="status" className={cn("px-3 py-4 text-sm text-white/50", detailsClass)}>
              {t("loading")}
            </p>
          )}
          {isError && (
            <div role="alert" className="px-1 py-3">
              <p className={cn("mb-3 break-words px-2 text-sm text-white/60", detailsClass)}>
                {errorMessage || t("loadFailed")}
              </p>
              <button
                type="button"
                onClick={onRetry}
                aria-label={t("retry")}
                className={cn(toggleClass, "w-full gap-2 text-sm")}
              >
                <IconRefresh className="size-4 shrink-0" />
                <span className={detailsClass}>{t("retry")}</span>
              </button>
            </div>
          )}
          {!isLoading && !isError && items.length === 0 && (
            <p role="status" className={cn("px-3 py-4 text-sm text-white/50", detailsClass)}>
              {t("noIps")}
            </p>
          )}
          {items.map((item) => {
            const active = item.id === selectedId;
            const label = [item.title, item.genre, item.trailer && t("hasVideo")]
              .filter(Boolean)
              .join(", ");
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item.id);
                  setMobileOpen(false);
                }}
                aria-current={active ? "true" : undefined}
                aria-label={label}
                title={label}
                className={cn(
                  "flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white",
                  active ? "bg-white/[0.07] text-white" : "text-white/85 hover:bg-white/5"
                )}
              >
                <IpThumbnail key={item.cover} item={item} />
                <span className={cn("min-w-0 flex-1", detailsClass)}>
                  <span className="block truncate text-[15px] font-medium leading-5">
                    {item.title}
                  </span>
                  <span className="mt-0.5 flex min-h-3.5 items-center gap-1.5 text-xs leading-[14px] text-white/45">
                    {item.trailer && (
                      <span
                        role="img"
                        aria-label={t("hasVideo")}
                        title={t("hasVideo")}
                        className="shrink-0"
                      >
                        <IconVideo aria-hidden className="size-3.5" />
                      </span>
                    )}
                    {item.genre && <span className="truncate">{item.genre}</span>}
                  </span>
                </span>
                {active && item.trailer && (
                  <span
                    role="img"
                    aria-label={isPlaying ? t("nowPlaying") : t("notPlaying")}
                    title={isPlaying ? t("nowPlaying") : t("notPlaying")}
                    className={cn("shrink-0", detailsClass)}
                  >
                    <span aria-hidden="true" className={styles.equalizer} data-playing={isPlaying}>
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                  </span>
                )}
              </button>
            );
          })}
          {hasMore && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={isLoadingMore}
              aria-label={isLoadingMore ? t("loading") : t("loadMore")}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-2 text-sm text-white/65 hover:bg-white/5 disabled:opacity-50"
            >
              <IconChevronDown aria-hidden className="size-4 shrink-0" />
              <span className={detailsClass}>{isLoadingMore ? t("loading") : t("loadMore")}</span>
            </button>
          )}
        </nav>
      </div>
    </aside>
  );
}

function IpThumbnail({ item }: { item: TvItem }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#303030] text-white/40">
      {item.cover && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.cover}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <IconDeviceTv aria-hidden className="size-5" />
      )}
    </span>
  );
}
