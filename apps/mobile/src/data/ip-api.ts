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
import { getLocale } from "@/i18n/locale-store";
import { api, ApiRequestError } from "@/lib/api-client";

import type {
  EpisodeAccess,
  Genre,
  IpAccess,
  IpAccessCode,
  IpDetail,
  IpPublisherPublic,
  IpDiscovery,
  IpEngagementSnapshot,
  IpEpisode,
  IpStatus,
  IpSummary,
  Person,
  PriceRule,
  Region,
  TaxonomyTerm,
} from "./types";

type AssetDto =
  | { kind?: string; url?: string | null; externalUrl?: string | null }
  | null
  | undefined;

type ContributorDto = {
  userId?: string | null;
  displayName?: string | null;
  role?: string | null;
  customRole?: string | null;
  isPublic?: boolean;
};

type EpisodeDto = {
  status?: string;
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
  /** Server-localized region display name (additive; older servers omit it). */
  regionLabel?: string | null;
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
  publishers?: IpPublisherPublic[];
  viewCount?: number | string | null;
  likeCount?: number | string | null;
  viewerHasLiked?: boolean | null;
  engagement?: EngagementDto | null;
};

const AURORA = { service: "aurora" } as const;

type EngagementDto = {
  viewCount?: number | string | null;
  likeCount?: number | string | null;
  viewerHasLiked?: boolean | null;
};

type EngagementCarrierDto = EngagementDto & {
  engagement?: EngagementDto | null;
};

type EngagementMutationResponse = {
  recorded?: boolean;
  liked?: boolean;
  changed?: boolean;
  engagement?: EngagementCarrierDto | null;
};

// Current UI locale, read at request time (the user can switch in-app).
function locale() {
  return getLocale();
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

function countNumber(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

function compactCount(value: number): string | undefined {
  if (value <= 0) return undefined;
  if (value < 1_000) return String(value);
  const units = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ];
  const unit = units.find((item) => value >= item.threshold);
  if (!unit) return String(value);
  const scaled = value / unit.threshold;
  const digits = scaled < 10 ? 1 : 0;
  return `${scaled.toFixed(digits).replace(/\.0$/, "")}${unit.suffix}`;
}

function engagementSnapshot(dto: EngagementCarrierDto | null | undefined): IpEngagementSnapshot {
  const source = dto?.engagement ?? dto ?? {};
  return {
    viewCount: countNumber(source.viewCount),
    likeCount: countNumber(source.likeCount),
    viewerHasLiked: source.viewerHasLiked === true,
  };
}

function normalizeRegionCode(region?: string | null): string | undefined {
  const code = region?.trim().toUpperCase();
  return code || undefined;
}

function mapSummary(dto: IpDto, featured = false): IpSummary {
  const cover = assetUrl(dto.coverAsset);
  const regionCode = normalizeRegionCode(dto.region);
  const engagement = engagementSnapshot(dto);
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
    // Server-curated label only (hand-maintained table — never Intl/CLDR, so
    // sensitive region naming stays controlled). Older servers omit it → show
    // the raw code until the server deploy lands.
    regionLabel: regionCode ? dto.regionLabel?.trim() || regionCode : undefined,
    typeTags: (dto.tags ?? []).filter(Boolean),
    typeTagCodes: (dto.tagCodes ?? []).filter(Boolean),
    year: dto.publishedAt ? new Date(dto.publishedAt).getFullYear() : undefined,
    rating: undefined,
    episodeCount: dto.episodes?.length || undefined,
    status: deriveStatus(dto),
    synopsis: dto.summary ?? dto.description ?? "",
    creator: creatorOf(dto),
    viewCount: engagement.viewCount,
    likeCount: engagement.likeCount,
    viewerHasLiked: engagement.viewerHasLiked,
    heatLabel: compactCount(engagement.viewCount),
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
  // Display index is 1-based list position (not raw episodeNo) so soft-deleted
  // gaps don't show as missing EP numbers — same rule as web public/studio UI.
  const episodes: IpEpisode[] = (dto.episodes ?? []).map((episode, index) => ({
    id: episode.id,
    index: index + 1,
    episodeNo: episode.episodeNo ?? undefined,
    feedbackEligible:
      episode.status === "published" &&
      Number.isInteger(episode.episodeNo) &&
      episode.episodeNo! >= 1 &&
      episode.episodeNo! <= 3 &&
      Boolean(episode.mediaAsset?.url),
    title: episode.title?.trim() || `Episode ${index + 1}`,
    durationLabel: durationLabel(episode.durationSeconds),
    thumbnailUrl: assetUrl(episode.coverAsset),
    // The episode's playable video is `mediaAsset`; fall back to a trailer preview.
    videoUrl: assetUrl(episode.mediaAsset) ?? assetUrl(episode.trailerAsset),
    mediaUrl:
      episode.status === "published" && episode.mediaAsset?.kind === "video"
        ? (episode.mediaAsset.url ?? undefined)
        : undefined,
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
    publishers: dto.publishers,
    longSynopsis: dto.description ?? dto.summary ?? "",
    episodes,
    cast,
    creators,
    trailerUrl: assetUrl(dto.trailerAsset),
    previewVideoUrl:
      [
        dto.trailerAsset,
        ...(dto.episodes ?? []).map((ep) => ep.trailerAsset),
        ...(dto.episodes ?? []).map((ep) => ep.mediaAsset),
      ].find((asset) => asset?.kind === "video" && asset.url)?.url ?? undefined,
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

async function fetchTaxonomy(type: "genre" | "tag", signal?: AbortSignal): Promise<TaxonomyTerm[]> {
  try {
    const res = await api.get<TaxonomyResponse>("/ip-commerce/taxonomy", {
      ...AURORA,
      params: { type, locale: locale() },
      signal,
    });
    return (res.items ?? [])
      .filter((term): term is { code: string; label: string } => !!term.code && !!term.label)
      .map((term) => ({ code: term.code, label: term.label }));
  } catch {
    return [];
  }
}

/** Genre list from Nest ip-commerce taxonomy (`/aurora/ip-commerce/taxonomy?type=genre`). */
async function fetchGenres(signal?: AbortSignal): Promise<Genre[]> {
  return fetchTaxonomy("genre", signal);
}

/** Content-type label list from Nest ip-commerce taxonomy (`/aurora/ip-commerce/taxonomy?type=tag`). */
async function fetchTypeTags(signal?: AbortSignal): Promise<TaxonomyTerm[]> {
  return fetchTaxonomy("tag", signal);
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
  signal,
  genreCode,
  limit = 50,
  regionCode,
  typeCode,
}: {
  cursor?: string | null;
  signal?: AbortSignal;
  genreCode?: string;
  limit?: number;
  regionCode?: string;
  typeCode?: string;
} = {}) {
  const [list, genres, typeTags] = await Promise.all([
    api.get<ListResponse>("/ip-commerce/ips", {
      ...AURORA,
      signal,
      params: {
        cursor: cursor ?? undefined,
        genreCodes: genreCode,
        limit,
        locale: locale(),
        regions: regionCode,
        tagCodes: typeCode,
      },
    }),
    fetchGenres(signal),
    fetchTypeTags(signal),
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

export interface IpTagPage {
  term: { code: string; label: string; description: string | null };
  total: number | null;
  items: IpSummary[];
  nextCursor: string | null;
}

/** Dedicated tag scope includes hidden taxonomy tags; ordinary catalog filters do not. */
export async function fetchIpTagPage(
  code: string,
  options: { cursor?: string; signal?: AbortSignal } = {}
): Promise<IpTagPage> {
  if (!code.trim() || code.length > 80) throw new Error("Invalid activity tag.");
  const result = await api.get<{
    term: IpTagPage["term"];
    total: number | null;
    items: IpDto[];
    nextCursor: string | null;
  }>(`/ip-commerce/tags/${encodeURIComponent(code)}/ips`, {
    ...AURORA,
    signal: options.signal,
    params: { cursor: options.cursor, limit: 24, locale: locale() },
  });
  if (
    !result ||
    result.term?.code !== code ||
    typeof result.term.label !== "string" ||
    (result.term.description !== null && typeof result.term.description !== "string") ||
    (result.total !== null && (!Number.isSafeInteger(result.total) || result.total < 0)) ||
    !Array.isArray(result.items) ||
    result.items.some(
      (item) => !item || typeof item.id !== "string" || !item.id || typeof item.title !== "string"
    ) ||
    new Set(result.items.map((item) => item.id)).size !== result.items.length ||
    (result.nextCursor !== null &&
      (typeof result.nextCursor !== "string" ||
        !result.nextCursor ||
        result.nextCursor === options.cursor ||
        !result.items.some((item) => item.id === result.nextCursor)))
  )
    throw new Error("Invalid activity response. Please retry.");
  return { ...result, items: result.items.map((item) => mapSummary(item)) };
}

/** A creator's published, publicly-listed IPs (Nest `creators/:id/ips`, @Public). */
export class InvalidCreatorIpPageError extends Error {}
export async function fetchCreatorIps(
  creatorId: string,
  limit = 12,
  signal?: AbortSignal
): Promise<IpSummary[]> {
  const items = new Map<string, IpSummary>();
  const visited = new Set<string>();
  const requestLocale = locale();
  let cursor: string | undefined;
  do {
    signal?.throwIfAborted();
    const res = await api.get<ListResponse>(
      `/ip-commerce/creators/${encodeURIComponent(creatorId)}/ips`,
      {
        ...AURORA,
        params: { locale: requestLocale, limit, cursor },
        signal,
        retry: false,
      }
    );
    signal?.throwIfAborted();
    if (
      !res ||
      !Array.isArray(res.items) ||
      res.items.some(
        (item) => !item || typeof item.id !== "string" || !item.id || typeof item.title !== "string"
      ) ||
      (res.nextCursor != null &&
        (typeof res.nextCursor !== "string" || !res.nextCursor || visited.has(res.nextCursor)))
    )
      throw new InvalidCreatorIpPageError("Invalid creator IP page");
    for (const item of res.items) items.set(item.id, mapSummary(item));
    cursor = res.nextCursor ?? undefined;
    if (cursor) visited.add(cursor);
  } while (cursor);
  return [...items.values()];
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
  for (let offset = 0; offset < userIds.length; offset += 50) {
    try {
      const res = await api.get<{ users?: LookupUser[] }>("/users/by-ids", {
        ...AURORA,
        params: { ids: userIds.slice(offset, offset + 50).join(",") },
      });
      for (const user of res.users ?? []) {
        if (user.userId) map.set(user.userId, user);
      }
    } catch {
      // Keep snapshot names for this batch; later contributors can still resolve.
    }
  }
  return map;
}

/** Resolve only the official public preview; never infer a full-episode URL. */
export async function fetchIpPreview(id: string, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  const res = await api.get<DetailResponse>(`/ip-commerce/ips/${encodeURIComponent(id)}`, {
    ...AURORA,
    params: { locale: locale() },
    signal,
  });
  signal.throwIfAborted();
  if (!res?.ip) return undefined;
  if (res.ip.id !== id) throw new Error("Preview identity mismatch");
  const url = mapDetail(res.ip).previewVideoUrl;
  if (!url) return undefined;
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error("Invalid preview URL");
  return url;
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

export async function recordIpView(
  ipId: string,
  input?: { idempotencyKey?: string; source?: string }
): Promise<IpEngagementSnapshot | undefined> {
  const res = await api.post<EngagementMutationResponse>(`/ip-commerce/ips/${ipId}/view`, {
    ...AURORA,
    data: {
      source: input?.source ?? "mobile_detail",
      idempotencyKey: input?.idempotencyKey,
    },
  });
  return res.engagement ? engagementSnapshot(res.engagement) : undefined;
}

export async function likeIp(ipId: string): Promise<IpEngagementSnapshot | undefined> {
  const res = await api.put<EngagementMutationResponse>(`/ip-commerce/ips/${ipId}/like`, AURORA);
  return res.engagement ? engagementSnapshot(res.engagement) : undefined;
}

export async function unlikeIp(ipId: string): Promise<IpEngagementSnapshot | undefined> {
  const res = await api.delete<EngagementMutationResponse>(`/ip-commerce/ips/${ipId}/like`, AURORA);
  return res.engagement ? engagementSnapshot(res.engagement) : undefined;
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

export type IpContentReport = {
  requestId?: string;
  targetType: "ip" | "episode";
  targetId: string;
  reason: IpReportReason;
  description?: string;
};

/** Uses the same IP/episode report contract as Web. */
export async function reportIpContent(report: IpContentReport): Promise<void> {
  await api.post("/ip-commerce/reports", {
    ...AURORA,
    data: { ...report, description: report.description?.trim() || undefined },
  });
}

/** Hide an IP for the signed-in viewer (auth'd; lists/detail filter it server-side). */
export async function blockIpContent(ipId: string): Promise<void> {
  await api.post("/ip-commerce/blocks", {
    ...AURORA,
    data: { targetType: "ip", targetId: ipId },
  });
}

// ─── Community-points balance + spend-to-unlock (Nest ip-commerce) ──────────

type PriceRuleDto =
  | {
      id: string;
      targetType: "ip" | "episode";
      amount: string;
      originalAmount?: string | null;
      memberAmount?: string | null;
      unlocksAt?: string | null;
    }
  | null
  | undefined;

function mapPrice(dto: PriceRuleDto): PriceRule | null {
  if (!dto) return null;
  return {
    id: dto.id,
    targetType: dto.targetType,
    amount: dto.amount,
    originalAmount: dto.originalAmount ?? null,
    memberAmount: dto.memberAmount ?? null,
    unlocksAt: dto.unlocksAt ?? null,
  };
}

type AccessDto = {
  authenticated?: boolean;
  member?: boolean;
  wallet?: { availableBalance?: string | null } | null;
  ip?: { owned?: boolean; access?: IpAccessCode; price?: PriceRuleDto } | null;
  episodes?: { id: string; owned?: boolean; access?: EpisodeAccess; price?: PriceRuleDto }[];
};

/** Authoritative per-viewer access + community-point balance for one IP
 *  (`GET /aurora/ip-commerce/ips/:id/access`). @Public — the api-client sends
 *  the viewer's auth automatically, so `owned`/`balance` reflect this user. */
export async function fetchIpAccess(ipId: string, episodeIds?: string[]): Promise<IpAccess> {
  const res = await api.get<AccessDto>(`/ip-commerce/ips/${ipId}/access`, {
    ...AURORA,
    params: {
      episodeIds: episodeIds?.length ? episodeIds.join(",") : undefined,
      locale: locale(),
    },
  });
  const episodes: IpAccess["episodes"] = {};
  for (const episode of res.episodes ?? []) {
    episodes[episode.id] = {
      owned: !!episode.owned,
      access: episode.access ?? "locked",
      price: mapPrice(episode.price),
    };
  }
  return {
    authenticated: !!res.authenticated,
    member: !!res.member,
    balance: res.wallet?.availableBalance ?? null,
    ip: {
      owned: !!res.ip?.owned,
      access: res.ip?.access ?? "locked",
      price: mapPrice(res.ip?.price),
    },
    episodes,
  };
}

type WalletDto = {
  accounts?: { currency?: string; balanceKind?: string; availableBalance?: string }[];
};

/** The signed-in user's spendable community-points balance (whole points, as a
 *  string). `GET /aurora/ip-commerce/wallet` (auth). Filters to the
 *  community_point/consumable account (NOT the withdrawable earnings pool).
 *  Throws when the wallet cannot be read; a valid empty wallet is zero. */
export async function fetchCommunityPointBalance(signal?: AbortSignal): Promise<string> {
  const res = await api.get<WalletDto>("/ip-commerce/wallet", {
    ...AURORA,
    signal,
    cache: "no-store",
  });
  if (
    !Array.isArray(res?.accounts) ||
    res.accounts.some(
      (account) => !account || typeof account !== "object" || Array.isArray(account)
    )
  )
    throw Error("Community balance is unavailable: invalid wallet data.");
  const account = res.accounts.find(
    (a) => a.currency === "community_point" && a.balanceKind === "consumable"
  );
  if (!account) return "0";
  if (typeof account.availableBalance !== "string" || !/^\d+$/.test(account.availableBalance))
    throw Error("Community balance is unavailable: invalid wallet data.");
  return account.availableBalance;
}

export type PurchaseResult = { alreadyOwned: boolean; alreadyProcessed: boolean };

/** Spend community points to unlock a whole IP (`targetType:"ip"`) or a single
 *  episode (`targetType:"episode"` + episodeId). `POST /aurora/ip-commerce/purchases`
 *  (auth). Throws ApiRequestError — use isInsufficientBalanceError / isMemberOnlyError
 *  to branch. A fresh idempotencyKey per call is safe: the server's entitlement
 *  guard returns alreadyOwned instead of double-charging on a lost-response retry. */
export async function purchaseIpContent(input: {
  ipId: string;
  targetType: "ip" | "episode";
  episodeId?: string;
  priceRuleId?: string;
}): Promise<PurchaseResult> {
  const res = await api.post<{ alreadyOwned?: boolean; alreadyProcessed?: boolean }>(
    "/ip-commerce/purchases",
    {
      ...AURORA,
      data: {
        ipId: input.ipId,
        targetType: input.targetType,
        episodeId: input.targetType === "episode" ? input.episodeId : undefined,
        priceRuleId: input.priceRuleId,
        idempotencyKey: newIdempotencyKey(),
      },
    }
  );
  return { alreadyOwned: !!res.alreadyOwned, alreadyProcessed: !!res.alreadyProcessed };
}

/** Unique-per-attempt purchase key (8–160 chars; no crypto lib needed). */
function newIdempotencyKey(): string {
  const rand = () => Math.random().toString(36).slice(2);
  return `m-${Date.now()}-${rand()}-${rand()}`;
}

/** Server signalled the community-point balance was too low (409 + business code).
 *  The mobile api-client surfaces the HTTP status; the business code sits in the
 *  raw responseBody, so match on both. */
export function isInsufficientBalanceError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    error.status === 409 &&
    !!error.responseBody?.includes("INSUFFICIENT_COMMUNITY_POINTS")
  );
}

/** Server refused because the IP is community-members-only (403). */
export function isMemberOnlyError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    error.status === 403 &&
    !!error.responseBody?.includes("IP_MEMBER_ONLY")
  );
}

/** A creator-owned IP row; `published` mirrors the public-detail visibility
 * predicate (status published/scheduled + public/unlisted listing). */
export type MyIp = IpSummary & { published: boolean };

/** The signed-in user's own IPs (auth'd; `/aurora/ip-commerce/me/ips`). */
export async function fetchMyIpsPage(
  cursor: string | null = null,
  signal?: AbortSignal
): Promise<{ items: MyIp[]; nextCursor: string | null }> {
  const res = await api.get<ListResponse>("/ip-commerce/me/ips", {
    ...AURORA,
    signal,
    params: { cursor: cursor ?? undefined, limit: 50, locale: locale() },
  });
  if (
    !res ||
    !Array.isArray(res.items) ||
    res.items.some(
      (item) => !item || typeof item.id !== "string" || !item.id || typeof item.title !== "string"
    ) ||
    (res.nextCursor !== null &&
      (typeof res.nextCursor !== "string" ||
        !res.nextCursor ||
        res.nextCursor === cursor ||
        !res.items.some((item) => item.id === res.nextCursor)))
  ) {
    throw new Error("Invalid owned IP response. Please retry.");
  }
  return {
    items: res.items.map((dto) => ({
      ...mapSummary(dto),
      published:
        (dto.status === "published" || dto.status === "scheduled") &&
        (dto.listingVisibility === "public" || dto.listingVisibility === "unlisted"),
    })),
    nextCursor: res.nextCursor,
  };
}
