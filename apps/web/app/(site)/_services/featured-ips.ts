/**
 * Homepage-local IP fetcher for the "Made with FizzDragon" content wall.
 *
 * This reads the same public IP commerce feed as `/ips`, while keeping
 * the homepage data shape local to the homepage.
 */

export interface FeaturedIP {
  id: string;
  ownerName: string;
  name: string;
  bannerLink: string;
}

interface FeaturedIpAsset {
  url: string | null;
  externalUrl: string | null;
}

interface FeaturedIpRow {
  id: string;
  title: string;
  copyrightOwner: string | null;
  coverAsset: FeaturedIpAsset | null;
}

export async function fetchFeaturedIPs(limit = 8): Promise<FeaturedIP[]> {
  const lang = typeof document !== "undefined" ? document.documentElement.lang || "en-US" : "en-US";
  const qs = new URLSearchParams({ limit: String(limit), locale: lang });
  const res = await fetch(`/aurora/ip-commerce/ips?${qs.toString()}`, {
    credentials: "include",
    headers: { "accept-language": lang },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    code: number;
    data?: { items?: FeaturedIpRow[] };
  };
  const rows = json.data?.items ?? [];
  return rows.map((row) => ({
    id: row.id,
    ownerName: row.copyrightOwner ?? "",
    name: row.title,
    bannerLink: row.coverAsset?.url ?? row.coverAsset?.externalUrl ?? "",
  }));
}

export function ipBannerUrl(path?: string | null): string {
  return path ?? "";
}
