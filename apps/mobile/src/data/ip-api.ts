/**
 * Real IP browse API — Nest ip-commerce public endpoints, reached via the
 * /aurora proxy. All endpoints are @Public (no auth).
 *
 * Call form note: `auroraBaseUrl` already ends in `/aurora`, so the path must
 * NOT repeat it — use `api.get("/ip-commerce/...", { service: "aurora" })`,
 * which resolves to `<auroraBaseUrl>/ip-commerce/...`.
 *
 * Region note: as of 2026-06, ip-commerce is served on the global host
 * (fizzdragon.com/aurora); the CN host returns 404 for these routes.
 */
import { appEnv } from "@/config";
import { api } from "@/lib/api-client";

import type { Genre, IpDetail, IpDiscovery, IpEpisode, IpStatus, IpSummary, Person } from "./types";

type AssetDto = { url?: string | null; externalUrl?: string | null } | null | undefined;

type ContributorDto = {
  displayName?: string | null;
  role?: string | null;
  customRole?: string | null;
  isPublic?: boolean;
};

type EpisodeDto = {
  id: string;
  episodeNo?: number | null;
  title?: string | null;
  durationSeconds?: number | null;
  isFreePreview?: boolean;
  coverAsset?: AssetDto;
};

type IpDto = {
  id: string;
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  description?: string | null;
  genres?: string[];
  genreCodes?: string[];
  tags?: string[];
  status?: string;
  publishedAt?: string | null;
  scheduledAt?: string | null;
  copyrightOwner?: string | null;
  coverAsset?: AssetDto;
  trailerAsset?: AssetDto;
  contributors?: ContributorDto[];
  episodes?: EpisodeDto[];
};

const AURORA = { service: "aurora" } as const;

function locale() {
  return appEnv.defaultLocale;
}

function assetUrl(asset: AssetDto): string | undefined {
  return asset?.url ?? asset?.externalUrl ?? undefined;
}

function creatorOf(dto: IpDto): string {
  const contributor = (dto.contributors ?? []).find((c) => c.isPublic && c.displayName);
  return contributor?.displayName ?? dto.copyrightOwner ?? "FizzDragon";
}

function deriveStatus(dto: IpDto): IpStatus {
  if (dto.scheduledAt && Date.parse(dto.scheduledAt) > Date.now()) return "upcoming";
  return "updating";
}

function durationLabel(seconds?: number | null): string | undefined {
  if (!seconds) return undefined;
  return `${Math.max(1, Math.round(seconds / 60))}m`;
}

function mapSummary(dto: IpDto, featured = false): IpSummary {
  const cover = assetUrl(dto.coverAsset);
  return {
    id: dto.id,
    title: dto.title,
    tagline: dto.subtitle ?? undefined,
    coverUrl: cover ?? assetUrl(dto.trailerAsset),
    backdropUrl: cover,
    // Genres only (real taxonomy genres) — tags like competition labels are NOT genres.
    genres: (dto.genres ?? []).filter(Boolean),
    genreCodes: (dto.genreCodes ?? []).filter(Boolean),
    year: dto.publishedAt ? new Date(dto.publishedAt).getFullYear() : undefined,
    rating: undefined,
    episodeCount: dto.episodes?.length || undefined,
    status: deriveStatus(dto),
    synopsis: dto.summary ?? dto.description ?? "",
    creator: creatorOf(dto),
    featured,
  };
}

function mapPeople(dto: IpDto): Person[] {
  return (dto.contributors ?? [])
    .filter((c) => c.isPublic && c.displayName)
    .map((c, index) => ({
      id: `${dto.id}-c-${index}`,
      name: c.displayName as string,
      role: c.customRole ?? c.role ?? undefined,
    }));
}

function mapDetail(dto: IpDto): IpDetail {
  const episodes: IpEpisode[] = (dto.episodes ?? []).map((episode, index) => ({
    id: episode.id,
    index: episode.episodeNo ?? index + 1,
    title: episode.title ?? `Episode ${episode.episodeNo ?? index + 1}`,
    durationLabel: durationLabel(episode.durationSeconds),
    thumbnailUrl: assetUrl(episode.coverAsset),
    free: !!episode.isFreePreview,
  }));
  const people = mapPeople(dto);
  const creatorRoles = ["owner", "creator", "director", "producer", "writer", "showrunner"];
  const isCreator = (person: Person) =>
    !!person.role && creatorRoles.includes(person.role.toLowerCase());
  // Split into disjoint sets so the detail screen can concat them without key clashes.
  const creators = people.filter(isCreator);
  const cast = people.filter((person) => !isCreator(person));

  return {
    ...mapSummary(dto),
    longSynopsis: dto.description ?? dto.summary ?? "",
    episodes,
    cast,
    creators,
    tags: [...(dto.genres ?? []), ...(dto.tags ?? [])].filter(Boolean),
    // No server-side room number yet; the detail chip stays hidden when undefined.
    roomCode: undefined,
  };
}

type TaxonomyResponse = { items?: { code?: string; label?: string }[] };

/** Genre list from Nest ip-commerce taxonomy (`/aurora/ip-commerce/taxonomy?type=genre`). */
async function fetchGenres(): Promise<Genre[]> {
  try {
    const res = await api.get<TaxonomyResponse>("/ip-commerce/taxonomy", {
      ...AURORA,
      params: { type: "genre", locale: locale() },
    });
    return (res.items ?? [])
      .filter((term): term is { code: string; label: string } => !!term.code && !!term.label)
      .map((term) => ({ code: term.code, label: term.label }));
  } catch {
    return [];
  }
}

type ListResponse = { items?: IpDto[]; nextCursor?: string | null };
type DiscoveryResponse = { items?: { ipCard?: IpDto | null }[] };
type DetailResponse = { ip?: IpDto | null };

async function fetchPlacement(placementKey: string): Promise<IpSummary[]> {
  try {
    const res = await api.get<DiscoveryResponse>("/ip-commerce/discovery", {
      ...AURORA,
      params: { placementKey, locale: locale() },
    });
    return (res.items ?? [])
      .map((item) => item.ipCard)
      .filter((card): card is IpDto => !!card)
      .map((card) => mapSummary(card, true));
  } catch {
    return [];
  }
}

export async function fetchIpDiscovery(): Promise<IpDiscovery> {
  const [hero, forYou, list, genres] = await Promise.all([
    fetchPlacement("ip_plaza_hero"),
    fetchPlacement("ip_plaza_for_you"),
    api.get<ListResponse>("/ip-commerce/ips", {
      ...AURORA,
      params: { limit: 30, locale: locale() },
    }),
    fetchGenres(),
  ]);

  const all = (list.items ?? []).map((dto) => mapSummary(dto));
  const featured = hero.length ? hero : all.slice(0, 3).map((ip) => ({ ...ip, featured: true }));
  const trending = forYou.length ? forYou : all.slice(0, 8);

  return { featured, trending, updating: all, genres };
}

export async function fetchIpDetail(id: string): Promise<IpDetail | undefined> {
  const res = await api.get<DetailResponse>(`/ip-commerce/ips/${id}`, {
    ...AURORA,
    params: { locale: locale() },
  });
  return res?.ip ? mapDetail(res.ip) : undefined;
}
