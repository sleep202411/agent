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
  id: string;
  index: number;
  title: string;
  durationLabel?: string;
  thumbnailUrl?: string;
  free?: boolean;
  /** Playable video URL (from the episode's trailer/video asset). */
  videoUrl?: string;
}

export interface IpSummary {
  id: string;
  title: string;
  tagline?: string;
  coverUrl?: string;
  backdropUrl?: string;
  genres: string[];
  /** Genre taxonomy codes (for filtering against the taxonomy). */
  genreCodes: string[];
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

/** A genre taxonomy term (from Nest ip-commerce `/taxonomy?type=genre`). */
export interface Genre {
  code: string;
  label: string;
}

export interface IpDiscovery {
  featured: IpSummary[];
  trending: IpSummary[];
  updating: IpSummary[];
  genres: Genre[];
}

export type CrewStatus = "recruiting" | "in-production" | "closed";

export interface CrewRoleOpening {
  id: string;
  title: string;
  count: number;
  note?: string;
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

export interface CrewDetail extends CrewSummary {
  description: string;
  roles: CrewRoleOpening[];
  members: Person[];
}

export interface NewsArticle {
  id: string;
  title: string;
  excerpt: string;
  coverUrl?: string;
  source: string;
  publishedLabel: string;
  /** External article link — News items open in a browser. */
  url?: string;
  /** Upstream placement/type tag; usually not surfaced. */
  category?: string;
  featured?: boolean;
}
