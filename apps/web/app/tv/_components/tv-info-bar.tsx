"use client";

import Link from "next/link";
import { IconPlayerPlay, IconUser } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import type { TvItem } from "../_hooks/types";

interface TvInfoBarProps {
  item: TvItem;
}

export function TvInfoBar({ item }: TvInfoBarProps) {
  const t = useTranslations("tv");
  const locale = useLocale() as Locale;

  return (
    <div className="flex max-h-[40%] shrink-0 flex-wrap items-center gap-x-8 gap-y-4 overflow-y-auto bg-black px-5 pb-6 pt-4 sm:px-8">
      <div className="min-w-0 flex-[1_1_20rem] space-y-2">
        <h1 className="text-xl font-semibold leading-tight text-white sm:text-2xl">{item.title}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {item.subtitle && <span className="text-white/50">{item.subtitle}</span>}
          <span className="flex items-center gap-1.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-white/10">
              <IconUser className="size-3 text-white/70" />
            </span>
            <span className="font-medium text-white/85">{item.ownerName}</span>
          </span>
          {item.episodeCount > 0 && (
            <span className="text-xs text-white/40">
              {t("episodeCount", { count: item.episodeCount })}
            </span>
          )}
        </div>
        {item.description && (
          <p className="line-clamp-2 text-sm leading-relaxed text-white/70">{item.description}</p>
        )}
      </div>
      <Link
        href={localizePath(`/ips/${item.id}`, locale)}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
      >
        <IconPlayerPlay className="size-4" />
        {t("viewDetail")}
      </Link>
    </div>
  );
}
