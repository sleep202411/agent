import { api } from "@/lib/api";

/** A random public IP served as a story-studio inspiration seed. */
export interface IpStarterSeed {
  id: string;
  title: string;
  summary: string;
  coverUrl: string | null;
}

/** Random public IPs from the plaza pool (`/aurora/ip-commerce/ips/random`). */
export async function fetchRandomIpSeeds(limit = 4, locale?: string): Promise<IpStarterSeed[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (locale) params.set("locale", locale);
  const data = await api.get<{ items: IpStarterSeed[] }>(
    `/aurora/ip-commerce/ips/random?${params.toString()}`
  );
  return data.items;
}
