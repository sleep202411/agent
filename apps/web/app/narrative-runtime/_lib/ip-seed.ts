/**
 * Fetch an IP's public "seed" (title / summary / description / genres /
 * episodes) from the Nest ip-commerce domain, server-side. This is the input
 * the architect prompt turns into a playable bible.
 *
 * Uses SERVER_URL (the same base the /aurora proxy targets), so it works
 * whether SERVER_URL points at local Nest or prod.
 */

export interface IpSeed {
  ipId: string;
  title: string;
  subtitle: string | null;
  summary: string;
  description: string | null;
  genres: string[];
  ageRating: string | null;
  episodes: Array<{ title: string; summary: string | null }>;
}

export async function fetchIpSeed(ipId: string, locale: string): Promise<IpSeed | null> {
  const base = process.env.SERVER_URL?.trim();
  if (!base) throw new Error("SERVER_URL is not set");

  const url = `${base.replace(/\/$/, "")}/ip-commerce/ips/${encodeURIComponent(ipId)}?locale=${encodeURIComponent(locale)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) return null;

  const json = (await res.json()) as { data?: { ip?: Record<string, unknown> } };
  const ip = json?.data?.ip;
  if (!ip || typeof ip.title !== "string") return null;

  const genres = Array.isArray(ip.genres)
    ? (ip.genres as unknown[]).filter((g): g is string => typeof g === "string")
    : [];
  const episodes = Array.isArray(ip.episodes)
    ? (ip.episodes as Array<Record<string, unknown>>).slice(0, 24).map((e) => ({
        title: typeof e.title === "string" ? e.title : "",
        summary: typeof e.summary === "string" ? e.summary : null,
      }))
    : [];

  return {
    ipId,
    title: ip.title,
    subtitle: typeof ip.subtitle === "string" ? ip.subtitle : null,
    summary: typeof ip.summary === "string" ? ip.summary : "",
    description: typeof ip.description === "string" ? ip.description : null,
    genres,
    ageRating: typeof ip.ageRating === "string" ? ip.ageRating : null,
    episodes,
  };
}
