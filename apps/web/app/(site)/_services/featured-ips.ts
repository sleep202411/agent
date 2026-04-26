/**
 * Homepage-local IP fetcher for the "Made with FizzDragon" content wall.
 *
 * Intentionally duplicates a slice of the IP feature's service rather
 * than reaching into `app/(site)/ips/_hooks/use-ip.ts`. The homepage and
 * the IP feature are independent modules — keeping their data layers
 * separate trades a small amount of repetition for proper module
 * isolation. If the homepage's needs grow beyond fetching a few covers,
 * extend this file rather than coupling back to the IP feature.
 */

import { env } from "@/src/env";

export interface FeaturedIP {
  id: number;
  ownerName: string;
  name: string;
  bannerLink: string;
}

export async function fetchFeaturedIPs(limit = 8): Promise<FeaturedIP[]> {
  // `credentials: "include"` and `accept-language` mirror the legacy /
  // shared backend client. `Authorization: Bearer <satoken or empty>`
  // is required: legacy fizzdragon-web always sends `Bearer ${token||''}`,
  // and the backend NPEs without the header even when the token is empty.
  const lang = typeof document !== "undefined" ? document.documentElement.lang || "en-US" : "en-US";
  let bearer = "Bearer ";
  if (typeof document !== "undefined") {
    const m = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
    bearer = `Bearer ${m?.[1] ?? ""}`;
  }
  const res = await fetch("/vedio/project/search", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "accept-language": lang,
      Authorization: bearer,
    },
    body: new URLSearchParams({ page: "1", pageSize: String(limit), key: "" }),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { code: number; data: FeaturedIP[] };
  return json.data ?? [];
}

export function ipBannerUrl(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${env.BANNER_BASE_URL}/${path}`;
}
