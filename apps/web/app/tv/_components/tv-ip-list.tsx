"use client";
import { ChannelBadge } from "@/components/channel-badge";

import { useState } from "react";
import Link from "next/link";
import {
  IconChevronDown,
  IconDeviceTv,
  IconFlame,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconRefresh,
  IconSearch,
  IconVideo,
  IconX,
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
  search: string;
  onSearchChange: (value: string) => void;
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
  search,
  onSearchChange,
}: TvIpListProps) {
  const t = useTranslations("tv");
  const locale = useLocale() as Locale;
  const [collapsed, setCollapsed] = useState(false);
  const detailsClass = collapsed ? "lg:hidden" : undefined;
  const toggleClass =
    "flex size-11 shrink-0 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:size-9";

  return (
    <aside
      aria-label={t("listTitle")}
      className={cn(
        "relative z-30 order-last min-w-0 w-full shrink-0 lg:order-none lg:h-full lg:w-[72px]",
        !collapsed && "lg:w-[280px]"
      )}
    >
      <div className="relative flex w-full flex-col border-t border-white/[0.06] bg-[#0c0e13] lg:h-full lg:border-r lg:border-t-0">
        <header
          className={cn(
            "hidden shrink-0 flex-col gap-2 border-b border-white/[0.06] px-3 py-2 lg:flex",
            collapsed && "items-center"
          )}
        >
          <div
            className={cn(
              "flex h-9 items-center gap-3",
              collapsed ? "justify-center" : "justify-between"
            )}
          >
            {embedded ? (
              <span className={cn("block text-sm font-semibold text-white", detailsClass)}>
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
              className={toggleClass}
            >
              {collapsed ? (
                <IconLayoutSidebarLeftExpand className="size-[18px]" />
              ) : (
                <IconLayoutSidebarLeftCollapse className="size-[18px]" />
              )}
            </button>
          </div>
          {!collapsed && (
            <label className="relative block">
              <span className="sr-only">{t("searchLabel")}</span>
              <IconSearch
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/35"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="h-9 w-full rounded-md border border-white/10 bg-white/[0.04] py-1.5 pl-8 pr-8 text-sm text-white placeholder:text-white/35 outline-none focus-visible:border-white/30 focus-visible:ring-1 focus-visible:ring-white/20"
              />
              {search ? (
                <button
                  type="button"
                  aria-label={t("searchClear")}
                  onClick={() => onSearchChange("")}
                  className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-white/45 hover:bg-white/10 hover:text-white"
                >
                  <IconX className="size-3.5" />
                </button>
              ) : null}
            </label>
          )}
        </header>

        {/* Mobile search — always visible above the horizontal channel strip. */}
        <div className="border-b border-white/[0.06] px-3 py-2 lg:hidden">
          <label className="relative block">
            <span className="sr-only">{t("searchLabel")}</span>
            <IconSearch
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/35"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-10 w-full rounded-md border border-white/10 bg-white/[0.04] py-1.5 pl-8 pr-8 text-sm text-white placeholder:text-white/35 outline-none focus-visible:border-white/30 focus-visible:ring-1 focus-visible:ring-white/20"
            />
            {search ? (
              <button
                type="button"
                aria-label={t("searchClear")}
                onClick={() => onSearchChange("")}
                className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-white/45 hover:bg-white/10 hover:text-white"
              >
                <IconX className="size-3.5" />
              </button>
            ) : null}
          </label>
        </div>

        <nav
          id="tv-ip-list"
          data-lenis-prevent
          aria-label={t("listTitle")}
          className={cn(
            "block max-h-64 space-y-0.5 overflow-x-hidden overflow-y-auto overscroll-contain px-2 py-3 lg:max-h-none [scrollbar-width:thin] lg:block lg:min-h-0 lg:flex-1 lg:snap-none lg:space-y-0.5 lg:overflow-x-hidden lg:overflow-y-auto lg:overscroll-contain",
            collapsed ? "lg:px-2" : "lg:px-3"
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
              {search.trim() ? t("noSearchResults") : t("noIps")}
            </p>
          )}
          {items.map((item) => {
            const active = item.id === selectedId;
            const roomNumber = t("roomNumber", { number: item.roomNumber });
            const label = [
              item.title,
              roomNumber,
              item.genre,
              item.hot && t("hot"),
              item.trailer && t("hasVideo"),
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={active ? "true" : undefined}
                aria-label={label}
                aria-describedby={`tv-production-stage-${item.id}`}
                title={label}
                className={cn(
                  "flex min-h-[64px] w-full shrink-0 items-center justify-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white lg:min-h-[52px] lg:w-full",
                  active ? "bg-white/[0.07] text-white" : "text-white/85 hover:bg-white/5"
                )}
              >
                <span className="relative shrink-0">
                  <IpThumbnail key={item.cover} item={item} />
                  {item.hot ? (
                    <span
                      role="img"
                      aria-label={t("hot")}
                      title={t("hot")}
                      className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-[#0c0e13] text-primary"
                    >
                      <IconFlame aria-hidden className="size-3" stroke={1.75} />
                    </span>
                  ) : null}
                </span>
                <span className={cn("block min-w-0 flex-1", detailsClass)}>
                  <span className="block truncate text-sm font-medium leading-5 lg:text-[15px]">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs tabular-nums text-white/50">
                    {roomNumber}
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
                    <ChannelBadge category={item.channelType} />
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
              className="flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-md px-2 text-sm text-white/65 hover:bg-white/5 disabled:opacity-50 lg:mt-3 lg:w-full"
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
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#303030] text-white/40 lg:size-9">
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
