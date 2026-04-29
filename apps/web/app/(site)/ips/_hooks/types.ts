/**
 * Public-facing types for the IP feature data layer. Re-exported through
 * `_hooks/use-ip` so route / component code only ever imports from there.
 */

export interface IPProject {
  id: number;
  ownerId: number;
  ownerName: string;
  ownerAvatar: string;
  name: string;
  typeId: number;
  bannerLink: string;
  videoLink: string | null;
  description: string;
  createTime: string;
  projectStatus: number;
  contact: string;
  tag: string | null;
  background: string | null;
}

/** `{ "<id>": "<name>" }` lookup map for the category badge under cards. */
export type CategoryMap = Record<string, string>;

export interface IPListResult {
  list: IPProject[];
  total: number;
  currentPage: number;
  pageSize: number;
}

export interface IPType {
  id: number;
  name: string;
}

export interface IPTag {
  id: number;
  name: string;
  /** Foreign key into `IPType.id`. */
  typeId: number;
}

// Public-facing episode shape, mirroring what the backend will return per
// `apps/web/app/(site)/ips/README.md §1`. Distinct from `EpisodeDraft` in
// the editor (which carries client-side upload state).
export interface Episode {
  id: string;
  projectId: string;
  title: string;
  description: string;
  videoUrl: string;
  cover: string;
  duration: number;
  type: "linear" | "interactive";
  sort: number;
  createdAt?: string;
}

export interface VideoMeta {
  width?: number;
  height?: number;
  size?: number;
  /** Seconds. */
  duration?: number;
}

export interface CreateEpisodeInput {
  projectId: string;
  title: string;
  description: string;
  videoUrl: string;
  cover: string;
  /** Episode order; backend defaults to `max(existing)+1` if omitted. */
  sort?: number;
  /** Browser-probed metadata; backend may persist or ignore. */
  videoMeta?: VideoMeta;
}

export interface UpdateEpisodeInput {
  id: string;
  projectId: string;
  title?: string;
  description?: string;
  videoUrl?: string;
  cover?: string;
  sort?: number;
  videoMeta?: VideoMeta;
}

export interface FAQ {
  id: number;
  projectId: number;
  question: string;
  answer: string;
  sort: number;
}

export interface FeaturedSlide {
  id: string;
  title: string;
  subtitle: string;
  /** Top eyebrow label, e.g. "INVESTING NOW". */
  eyebrow: string;
  description: string;
  /** Hero key-art URL (~1920×1080). */
  keyArt: string;
  tags: string[];
  episodes: number;
}

export interface RailItem {
  id: string;
  title: string;
  /** Landscape cover URL (~600×400). */
  cover: string;
  episodes: number;
}

// Re-export shared project types so IP code only ever imports from
// `_hooks/use-ip`.
export type { Project, ProjectMember, ProjectJob } from "@/src/services/project";
