"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";
import type { IpCommerceAsset, IpCommerceIp } from "@/src/lib/ip-commerce/api";
import { useIpCommerceDiscovery } from "@/src/lib/ip-commerce/hooks";
import { ipPreviewVideoUrl, previewVideoUrl } from "@/src/lib/ip-commerce/preview-video";
import { prioritizeForYou } from "./prioritize-for-you";
import type { TvItem } from "./types";

function listTvIps(params: { locale: string; cursor?: string; q?: string }) {
  return api.get<{ items: IpCommerceIp[]; nextCursor: string | null }>("/aurora/ip-commerce/ips", {
    params: {
      ...params,
      limit: 20,
    },
  });
}

export function useTvIps(options?: { q?: string }) {
  const locale = useLocale();
  const t = useTranslations("tv");
  const q = options?.q?.trim() || undefined;
  const query = useInfiniteQuery({
    queryKey: ["tv", "ips", locale, q ?? ""],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listTvIps({ locale, cursor: pageParam, q }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 60_000,
  });
  // Same operator rail as IP Plaza "For you". Search is an explicit catalog
  // query, so the rail steps aside.
  const discovery = useIpCommerceDiscovery({
    placementKey: "ip_plaza_for_you",
    locale,
    enabled: !q,
  });
  const forYouItems = useMemo(() => {
    if (q) return [];
    return (discovery.data?.items ?? [])
      .map((item) => {
        if (!item.ipCard || !ipPreviewVideoUrl(item.ipCard)) return null;
        return { ...toTvItem(item.ipCard, t), hot: true as const };
      })
      .filter((item) => item !== null);
  }, [discovery.data?.items, q, t]);
  const listedItems = useMemo(
    () =>
      query.data?.pages
        .flatMap((page) => page.items)
        .filter((ip) => Boolean(ipPreviewVideoUrl(ip)))
        .map((ip) => toTvItem(ip, t)) ?? [],
    [query.data, t]
  );
  const items = useMemo(
    () => prioritizeForYou(listedItems, forYouItems),
    [listedItems, forYouItems]
  );
  async function fetchNextChannels() {
    const result = await query.fetchNextPage({ cancelRefetch: false });
    if (result.isError) throw result.error;
    const listed =
      result.data?.pages
        .flatMap((page) => page.items)
        .filter((ip) => Boolean(ipPreviewVideoUrl(ip)))
        .map((ip) => toTvItem(ip, t)) ?? [];
    return {
      items: prioritizeForYou(listed, forYouItems),
      hasMore: result.hasNextPage,
    };
  }
  return {
    ...query,
    items,
    isLoading: query.isLoading || (!q && discovery.isLoading),
    fetchNextChannels,
    refetch: () => Promise.all([query.refetch(), !q ? discovery.refetch() : Promise.resolve()]),
  };
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
    episodes: ip.episodes
      .map((episode) => ({
        id: episode.id,
        number: episode.episodeNo,
        title: episode.title,
        video: previewVideoUrl(episode.mediaAsset),
        published: episode.status === "published",
      }))
      .filter((episode) => episode.published && Boolean(episode.video)),
  };
}

function getAssetUrl(asset: IpCommerceAsset | null | undefined) {
  return asset?.url || asset?.externalUrl || "";
}
