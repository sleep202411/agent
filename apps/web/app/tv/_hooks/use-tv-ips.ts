"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";
import type { IpCommerceAsset, IpCommerceIp } from "@/src/lib/ip-commerce/api";
import { ipPreviewVideoUrl } from "@/src/lib/ip-commerce/preview-video";
import type { TvItem } from "./types";

function listTvIps(params: { locale: string; cursor?: string }) {
  return api.get<{ items: IpCommerceIp[]; nextCursor: string | null }>("/aurora/ip-commerce/ips", {
    params: { ...params, limit: 20 },
  });
}

export function useTvIps() {
  const locale = useLocale();
  const t = useTranslations("tv");
  const query = useInfiniteQuery({
    queryKey: ["tv", "ips", locale],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listTvIps({ locale, cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 60_000,
  });
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items).map((ip) => toTvItem(ip, t)) ?? [],
    [query.data, t]
  );
  async function fetchNextChannels() {
    const result = await query.fetchNextPage({ cancelRefetch: false });
    if (result.isError) throw result.error;
    return {
      items: result.data?.pages.flatMap((page) => page.items).map((ip) => toTvItem(ip, t)) ?? [],
      hasMore: result.hasNextPage,
    };
  }
  return { ...query, items, fetchNextChannels };
}

/** Use the same public preview as plaza cards. */
function toTvItem(ip: IpCommerceIp, t: ReturnType<typeof useTranslations>): TvItem {
  const cover = getAssetUrl(ip.coverAsset);
  const trailer = ipPreviewVideoUrl(ip);
  return {
    id: ip.id,
    roomNumber: ip.roomNumber,
    title: ip.title || t("untitled"),
    subtitle: ip.subtitle || "",
    genre: ip.genres[0]?.trim() || "",
    description: ip.summary || ip.description || "",
    cover,
    trailer,
    ownerName: ip.copyrightOwner?.trim() || t("anonymousOwner"),
    episodeCount: ip.episodes.length,
  };
}

function getAssetUrl(asset: IpCommerceAsset | null | undefined) {
  return asset?.url || asset?.externalUrl || "";
}
