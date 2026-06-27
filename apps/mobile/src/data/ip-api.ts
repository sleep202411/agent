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
import { appEnv, resolveAssetUrl } from "@/config";
import { api } from "@/lib/api-client";

import type {
  Genre,
  IpDetail,
  IpDiscovery,
  IpEpisode,
  IpStatus,
  IpSummary,
  Person,
  Region,
  TaxonomyTerm,
} from "./types";

type AssetDto = { url?: string | null; externalUrl?: string | null } | null | undefined;

type ContributorDto = {
  userId?: string | null;
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
  mediaAsset?: AssetDto;
  trailerAsset?: AssetDto;
};

type IpDto = {
  id: string;
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  description?: string | null;
  region?: string | null;
  genres?: string[];
  genreCodes?: string[];
  tags?: string[];
  tagCodes?: string[];
  status?: string;
  listingVisibility?: string;
  publishedAt?: string | null;
  scheduledAt?: string | null;
  copyrightOwner?: string | null;
  rightsSummary?: { statement?: string | null } | null;
  aiDisclosure?: {
    generatedVisuals?: boolean;
    generatedCopy?: boolean;
    statement?: string | null;
  } | null;
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

function normalizeRegionCode(region?: string | null): string | undefined {
  const code = region?.trim().toUpperCase();
  return code || undefined;
}

function regionLabel(code: string): string {
  if (code === "GLOBAL") return "Global";
  try {
    const displayNames = new Intl.DisplayNames([locale()], { type: "region" });
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function mapSummary(dto: IpDto, featured = false): IpSummary {
  const cover = assetUrl(dto.coverAsset);
  const regionCode = normalizeRegionCode(dto.region);
  return {
    id: dto.id,
    title: dto.title,
    tagline: dto.subtitle ?? undefined,
    coverUrl: cover ?? assetUrl(dto.trailerAsset),
    backdropUrl: cover,
    // Genres only (real taxonomy genres) — tags like competition labels are NOT genres.
    genres: (dto.genres ?? []).filter(Boolean),
    genreCodes: (dto.genreCodes ?? []).filter(Boolean),
    regionCode,
    regionLabel: regionCode ? regionLabel(regionCode) : undefined,
    typeTags: (dto.tags ?? []).filter(Boolean),
    typeTagCodes: (dto.tagCodes ?? []).filter(Boolean),
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
      userId: c.userId ?? undefined,
    }));
}

function mapDetail(dto: IpDto): IpDetail {
  const episodes: IpEpisode[] = (dto.episodes ?? []).map((episode, index) => ({
    id: episode.id,
    index: episode.episodeNo ?? index + 1,
    title: episode.title ?? `Episode ${episode.episodeNo ?? index + 1}`,
    durationLabel: durationLabel(episode.durationSeconds),
    thumbnailUrl: assetUrl(episode.coverAsset),
    // The episode's playable video is `mediaAsset`; fall back to a trailer preview.
    videoUrl: assetUrl(episode.mediaAsset) ?? assetUrl(episode.trailerAsset),
    free: !!episode.isFreePreview,
  }));
  const people = mapPeople(dto);
  const creatorRoles = ["owner", "creator", "director", "producer", "writer", "showrunner"];
  const isCreator = (person: Person) =>
    !!person.role && creatorRoles.includes(person.role.toLowerCase());
  // Split into disjoint sets so the detail screen can concat them without key clashes.
  const creators = people.filter(isCreator);
  const cast = people.filter((person) => !isCreator(person));

  const aiDisclosure = dto.aiDisclosure ?? {};
  return {
    ...mapSummary(dto),
    longSynopsis: dto.description ?? dto.summary ?? "",
    episodes,
    cast,
    creators,
    trailerUrl: assetUrl(dto.trailerAsset),
    tags: [...(dto.genres ?? []), ...(dto.tags ?? [])].filter(Boolean),
    // No server-side room number yet; the detail chip stays hidden when undefined.
    roomCode: undefined,
    copyrightOwner: dto.copyrightOwner?.trim() || undefined,
    // Same predicate the server's review gate uses for "is AI-generated".
    aiGenerated: aiDisclosure.generatedVisuals === true || aiDisclosure.generatedCopy === true,
    rightsStatement: dto.rightsSummary?.statement?.trim() || undefined,
    aiStatement: aiDisclosure.statement?.trim() || undefined,
  };
}

type TaxonomyResponse = { items?: { code?: string; label?: string }[] };

async function fetchTaxonomy(type: "genre" | "tag"): Promise<TaxonomyTerm[]> {
  try {
    const res = await api.get<TaxonomyResponse>("/ip-commerce/taxonomy", {
      ...AURORA,
      params: { type, locale: locale() },
    });
    return (res.items ?? [])
      .filter((term): term is { code: string; label: string } => !!term.code && !!term.label)
      .map((term) => ({ code: term.code, label: term.label }));
  } catch {
    return [];
  }
}

/** Genre list from Nest ip-commerce taxonomy (`/aurora/ip-commerce/taxonomy?type=genre`). */
async function fetchGenres(): Promise<Genre[]> {
  return fetchTaxonomy("genre");
}

/** Content-type label list from Nest ip-commerce taxonomy (`/aurora/ip-commerce/taxonomy?type=tag`). */
async function fetchTypeTags(): Promise<TaxonomyTerm[]> {
  return fetchTaxonomy("tag");
}

function regionsFromIps(ips: IpSummary[]): Region[] {
  const regions = new Map<string, string>();
  for (const ip of ips) {
    if (ip.regionCode && ip.regionLabel) {
      regions.set(ip.regionCode, ip.regionLabel);
    }
  }
  return Array.from(regions, ([code, label]) => ({ code, label })).sort((a, b) =>
    a.label.localeCompare(b.label, locale())
  );
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
  const [hero, forYou, list, genres, typeTags] = await Promise.all([
    fetchPlacement("ip_plaza_hero"),
    fetchPlacement("ip_plaza_for_you"),
    api.get<ListResponse>("/ip-commerce/ips", {
      ...AURORA,
      params: { limit: 30, locale: locale() },
    }),
    fetchGenres(),
    fetchTypeTags(),
  ]);

  const all = (list.items ?? []).map((dto) => mapSummary(dto));
  const featured = hero.length ? hero : all.slice(0, 3).map((ip) => ({ ...ip, featured: true }));
  const trending = forYou.length ? forYou : all.slice(0, 8);

  return { featured, trending, updating: all, genres, typeTags, regions: regionsFromIps(all) };
}

export async function fetchIpCatalogPage({
  cursor,
  genreCode,
  limit = 50,
  regionCode,
  typeCode,
}: {
  cursor?: string | null;
  genreCode?: string;
  limit?: number;
  regionCode?: string;
  typeCode?: string;
} = {}) {
  const [list, genres, typeTags] = await Promise.all([
    api.get<ListResponse>("/ip-commerce/ips", {
      ...AURORA,
      params: {
        cursor: cursor ?? undefined,
        genreCodes: genreCode,
        limit,
        locale: locale(),
        regions: regionCode,
        tagCodes: typeCode,
      },
    }),
    fetchGenres(),
    fetchTypeTags(),
  ]);

  const items = (list.items ?? []).map((dto) => mapSummary(dto));
  return {
    items,
    nextCursor: list.nextCursor ?? null,
    genres,
    typeTags,
    regions: regionsFromIps(items),
  };
}

/** A creator's published, publicly-listed IPs (Nest `creators/:id/ips`, @Public). */
export async function fetchCreatorIps(creatorId: string, limit = 12): Promise<IpSummary[]> {
  try {
    const res = await api.get<ListResponse>(`/ip-commerce/creators/${creatorId}/ips`, {
      ...AURORA,
      params: { locale: locale(), limit },
    });
    return (res.items ?? []).map((dto) => mapSummary(dto));
  } catch {
    return [];
  }
}

// Legacy default-avatar PNG baked into the user OSS bucket — treat as "no
// avatar" so the initial fallback shows instead of the generic silhouette.
const PLACEHOLDER_AVATAR_UUID = "d17b1d5e-282e-47e0-bd99-9a72477adf93";

/** Resolve a stored user-avatar value to a loadable URL (mirrors the web's
 * resolveUserAvatarUrl): http passes through, a bare path gets the user base. */
function resolveUserAvatarUrl(path?: string | null): string | undefined {
  if (!path || path.includes(PLACEHOLDER_AVATAR_UUID)) return undefined;
  return resolveAssetUrl(path, appEnv.assets.userBaseUrl) || undefined;
}

type LookupUser = { userId: string; nickname?: string | null; avatar?: string | null };

/** Batch-resolve live name/avatar by user id (`/aurora/users/by-ids?ids=`). */
async function fetchUserDisplays(userIds: string[]): Promise<Map<string, LookupUser>> {
  const map = new Map<string, LookupUser>();
  if (!userIds.length) return map;
  try {
    const res = await api.get<{ users?: LookupUser[] }>("/users/by-ids", {
      ...AURORA,
      params: { ids: userIds.slice(0, 50).join(",") },
    });
    for (const user of res.users ?? []) {
      if (user.userId) map.set(user.userId, user);
    }
  } catch {
    // Fall back to the contributor snapshot name + initial avatar.
  }
  return map;
}

export async function fetchIpDetail(id: string): Promise<IpDetail | undefined> {
  const res = await api.get<DetailResponse>(`/ip-commerce/ips/${id}`, {
    ...AURORA,
    params: { locale: locale() },
  });
  if (!res?.ip) return undefined;

  const detail = mapDetail(res.ip);
  // Contributor rows only carry a display-name snapshot (no avatar). Resolve
  // the live name + avatar by user id, same as the web's creator-team card.
  const userIds = Array.from(
    new Set(
      [...detail.creators, ...detail.cast]
        .map((person) => person.userId)
        .filter(Boolean) as string[]
    )
  );
  if (userIds.length) {
    const displays = await fetchUserDisplays(userIds);
    const enrich = (person: Person): Person => {
      const display = person.userId ? displays.get(person.userId) : undefined;
      if (!display) return person;
      return {
        ...person,
        name: display.nickname?.trim() || person.name,
        avatarUrl: resolveUserAvatarUrl(display.avatar) ?? person.avatarUrl,
      };
    };
    detail.creators = detail.creators.map(enrich);
    detail.cast = detail.cast.map(enrich);
  }
  return detail;
}

/** Report reasons accepted by Nest `POST /aurora/ip-commerce/reports`. */
export const IP_REPORT_REASONS = [
  "copyright",
  "unsafe_content",
  "fraud",
  "misleading",
  "privacy",
  "harassment",
  "other",
] as const;

export type IpReportReason = (typeof IP_REPORT_REASONS)[number];

/** File a content report against an IP (auth'd; admin reviews in ip-commerce). */
export async function reportIpContent(ipId: string, reason: IpReportReason): Promise<void> {
  await api.post("/ip-commerce/reports", {
    ...AURORA,
    data: { targetType: "ip", targetId: ipId, reason },
  });
}

/** Hide an IP for the signed-in viewer (auth'd; lists/detail filter it server-side). */
export async function blockIpContent(ipId: string): Promise<void> {
  await api.post("/ip-commerce/blocks", {
    ...AURORA,
    data: { targetType: "ip", targetId: ipId },
  });
}

/** A creator-owned IP row; `published` mirrors the public-detail visibility
 * predicate (status published/scheduled + public/unlisted listing). */
export type MyIp = IpSummary & { published: boolean };

/** The signed-in user's own IPs (auth'd; `/aurora/ip-commerce/me/ips`). */
export async function fetchMyIps(): Promise<MyIp[]> {
  try {
    const res = await api.get<ListResponse>("/ip-commerce/me/ips", {
      ...AURORA,
      params: { limit: 50, locale: locale() },
    });
    return (res.items ?? []).map((dto) => ({
      ...mapSummary(dto),
      published:
        (dto.status === "published" || dto.status === "scheduled") &&
        (dto.listingVisibility === "public" || dto.listingVisibility === "unlisted"),
    }));
  } catch {
    return [];
  }
}
