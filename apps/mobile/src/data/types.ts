/**
 * Browse-layer domain types. These double as the data contract for the future
 * server integration: the mock service in `browse-service.ts` returns exactly
 * these shapes, so swapping mock → `api.get(...)` is a localized change.
 */

export type IpStatus = "updating" | "completed" | "upcoming";

export interface Person {
  id: string;
  name: string;
  role?: string;
  avatarUrl?: string;
  /** Backing user id — used to resolve the live name/avatar by-id. */
  userId?: string;
}

export interface IpEpisode {
  episodeNo?: number;
  feedbackEligible?: boolean;
  id: string;
  index: number;
  title: string;
  durationLabel?: string;
  thumbnailUrl?: string;
  free?: boolean;
  /** Playable video URL (from the episode's trailer/video asset). */
  videoUrl?: string;
}

export interface IpEngagementSnapshot {
  viewCount: number;
  likeCount: number;
  viewerHasLiked: boolean;
}

export interface IpSummary extends IpEngagementSnapshot {
  id: string;
  title: string;
  tagline?: string;
  coverUrl?: string;
  backdropUrl?: string;
  genres: string[];
  /** Genre taxonomy codes (for filtering against the taxonomy). */
  genreCodes: string[];
  /** ISO-3166 alpha-2 code or server sentinel such as "GLOBAL". */
  regionCode?: string;
  /** Locale-aware display label for `regionCode`. */
  regionLabel?: string;
  /** Non-genre taxonomy tags used as content-type labels. */
  typeTags: string[];
  /** Non-genre taxonomy tag codes (for filtering against the taxonomy). */
  typeTagCodes: string[];
  year?: number;
  /** 0–10, one decimal. */
  rating?: number;
  episodeCount?: number;
  status: IpStatus;
  synopsis: string;
  creator: string;
  /** Human-readable popularity, e.g. "1.2M". */
  heatLabel?: string;
  featured?: boolean;
}

export interface IpDetail extends IpSummary {
  longSynopsis: string;
  episodes: IpEpisode[];
  cast: Person[];
  creators: Person[];
  tags: string[];
  /** Playable IP-level trailer URL, if the IP has one. */
  trailerUrl?: string;
  /** Human-shareable "room number". Not yet provided by the server — optional. */
  roomCode?: string;
  /** Rights holder (`Ip.copyrightOwner`). */
  copyrightOwner?: string;
  /** True when the creator declared AI-generated visuals and/or copy. */
  aiGenerated: boolean;
  /** Creator's rights statement (`rightsSummary.statement`). */
  rightsStatement?: string;
  /** Creator's AI-usage statement (`aiDisclosure.statement`). */
  aiStatement?: string;
}

/** A community-point price rule attached to an IP or episode (Nest ip-commerce).
 *  Amounts are WHOLE community points serialized as BigInt strings — compare
 *  with BigInt(), never assume number. `null` price = free. */
export interface PriceRule {
  id: string;
  targetType: "ip" | "episode";
  /** Charge price in whole community points (BigInt-as-string). */
  amount: string;
  /** Strike-through original price when discounted. */
  originalAmount?: string | null;
  /** Member-discounted price (present only for member viewers). Charge this when set. */
  memberAmount?: string | null;
  /** ISO — a pre-sale unlock becomes watchable at this time. */
  unlocksAt?: string | null;
}

/** Per-episode access state (Nest ip-commerce /access). Granted (playable) =
 *  free | free_preview | owned_* | member_free. */
export type EpisodeAccess =
  | "owned_ip"
  | "owned_episode"
  | "free_preview"
  | "pending_unlock_ip"
  | "pending_unlock_episode"
  | "member_free"
  | "member_locked"
  | "locked"
  | "locked_bundle"
  | "free";

/** Per-IP access state (Nest ip-commerce /access). */
export type IpAccessCode =
  | "owned"
  | "pending_unlock"
  | "member_free"
  | "member_locked"
  | "locked"
  | "free";

/** Authoritative per-viewer access + community-point balance map for one IP
 *  (Nest `/aurora/ip-commerce/ips/:id/access`). */
export interface IpAccess {
  authenticated: boolean;
  member: boolean;
  /** community_point/consumable available balance (whole points, string); null logged-out. */
  balance: string | null;
  ip: { owned: boolean; access: IpAccessCode; price: PriceRule | null };
  /** Keyed by episode id. */
  episodes: Record<string, { owned: boolean; access: EpisodeAccess; price: PriceRule | null }>;
}

/** An IP taxonomy term (from Nest ip-commerce `/taxonomy`). */
export interface TaxonomyTerm {
  code: string;
  label: string;
}

export type Genre = TaxonomyTerm;

export interface Region {
  code: string;
  label: string;
}

export interface IpDiscovery {
  featured: IpSummary[];
  trending: IpSummary[];
  updating: IpSummary[];
  genres: Genre[];
  typeTags: TaxonomyTerm[];
  regions: Region[];
}

export interface IpCatalogPage {
  items: IpSummary[];
  nextCursor: string | null;
  genres: Genre[];
  typeTags: TaxonomyTerm[];
  regions: Region[];
}

export type CrewStatus = "recruiting" | "in-production" | "closed";

export interface CrewRoleOpening {
  id: string;
  title: string;
  /** Canonical recruitment role code, or the author's custom title. */
  positionType?: string;
  count: number;
  location?: string;
  /** Raw EmploymentType enum (full_time | part_time | contract | freelance | project_based). */
  employmentType?: string;
}

export interface CrewSummary {
  id: string;
  name: string;
  tagline?: string;
  coverUrl?: string;
  location?: string;
  status: CrewStatus;
  openRoles: number;
  roleTags: string[];
  summary: string;
  memberCount?: number;
}

export interface CrewFeedPage {
  items: CrewSummary[];
  nextCursor: string | null;
}

export interface CrewDetail extends CrewSummary {
  description: string;
  roles: CrewRoleOpening[];
  members: Person[];
}

export interface CreatorLevel {
  id: string;
  name: string;
  iconUrl?: string;
  description?: string;
}

export interface CreatorSummary {
  id: string;
  name: string;
  avatarUrl?: string;
  bannerUrl?: string;
  bio?: string;
  joinedAt?: string;
  study?: string;
  levels: CreatorLevel[];
  primaryLevel?: string;
  openToWork: boolean;
}

export interface CreatorServiceSummary {
  id: string;
  creatorId: string;
  title: string;
  summary: string;
  coverUrl?: string;
  category: string;
  tags: string[];
  startingPrice: number;
  currency: string;
  startingDeliveryDays: number;
  packageCount: number;
  publishedAt: string;
}

export interface CreatorServicePackage {
  id: string;
  tier: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  deliveryDays: number;
  revisions: number;
  scope: string[];
}

export interface CreatorServiceDetail extends CreatorServiceSummary {
  version?: number;
  packages: CreatorServicePackage[];
  requirementQuestions: { id: string; prompt: string; helpText?: string; required: boolean }[];
  status: string;
  updatedAt: string;
}

/** A news tag — `id` is locale-stable, `label` follows the request locale. */
export interface NewsTag {
  id: string;
  label: string;
}

export interface NewsArticle {
  id: string;
  /** `external` opens `url` in a browser; `article` opens the site detail page. */
  kind: "article" | "external";
  title: string;
  excerpt: string;
  coverUrl?: string;
  publishedLabel: string;
  /** External article link — only set for `kind: "external"`. */
  url?: string;
  tags: NewsTag[];
}
