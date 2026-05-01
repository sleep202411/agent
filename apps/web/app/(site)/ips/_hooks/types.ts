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
}

// Public-facing episode shape, mirroring what the backend will return per
// `apps/web/app/(site)/ips/README.md §1`. Distinct from `EpisodeDraft` in
// the editor (which carries client-side upload state).
//
// **`videoLink` is an opaque wire identifier, not a playable URL.** It
// is the OSS object key the backend stores; treat it as an opaque
// string round-tripped on update to preserve attachment when the user
// only edits other fields. Use `useEpisodeVideoLink(episode.id)` to
// resolve a directly-playable URL via `/vedio/play/getLink`.
export interface Episode {
  id: string;
  projectId: string;
  title: string;
  description: string;
  /** Opaque wire identifier — round-trip on update; resolve to a
   *  playable URL via `useEpisodeVideoLink(episode.id)` when needed. */
  videoLink: string;
  /** Wire-format OSS object key. Pass through `ipImageUrl()` at the
   *  render site to get a directly-loadable `<img src>`. */
  videoBanner: string;
  duration: number;
  videoNumber: number;
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
  /** Wire-format OSS object key (persisted as `videoLink`). */
  videoLink: string;
  /** Wire-format OSS object key (persisted as `videoBanner`). */
  videoBanner: string;
  /** Episode order; backend defaults to `max(existing)+1` if omitted. */
  videoNumber?: number;
  /** Browser-probed metadata; backend may persist or ignore. */
  videoMeta?: VideoMeta;
}

export interface UpdateEpisodeInput {
  id: string;
  projectId: string;
  title?: string;
  description?: string;
  /** Wire-format OSS object key. Pass through unchanged when not editing
   *  the attachment — omitting risks the backend nulling the field. */
  videoLink?: string;
  videoBanner?: string;
  videoNumber?: number;
  videoMeta?: VideoMeta;
}

export interface FAQ {
  /** Backend uses `faqId` (int64) — not `id`. */
  faqId: number;
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

// ─── Project / member / job shapes (feature-private) ──────────
//
// These used to live in `@/src/services/project.ts` because multiple
// features read them. The IP feature now owns its own copy so it can
// evolve without breaking profile / creators / use-my-projects.
// If another feature later needs the same shape, it should redefine
// it locally — duplication is cheaper than a brittle shared dep.

export interface Project {
  id: number;
  ownerId?: number;
  ownerName?: string | null;
  ownerAvatar?: string | null;
  name: string;
  typeId?: number;
  bannerLink?: string | null;
  videoLink?: string | null;
  description?: string | null;
  /** 0=normal, 1=archived. */
  projectStatus?: number;
  contact?: string | null;
  tag?: string | null;
  background?: string | null;
  createTime?: string;
  // Future fields (pending backend).
  story?: string | null;
  whyThisIP?: string | null;
  targetEpisodes?: number | null;
}

export interface ProjectMember {
  id?: number;
  userId?: number;
  userName?: string | null;
  nickName?: string | null;
  avatar?: string | null;
  /** Backend `role` (int32). 0 = member, 8 = admin, 10 = owner — convention
   *  shared with `app/projects/_components/project-team-dialog.tsx`. */
  role?: number;
  /** Free-form note attached when adding the member, visible to the team. */
  remark?: string | null;
  /** Legacy alias retained while older endpoints still echo `roleId`. */
  roleId?: number;
  roleName?: string | null;
  profitRatio?: number;
  guaranteedIncome?: number;
  createTime?: string | null;
  [key: string]: unknown;
}

export interface ProjectJob {
  id?: number;
  projectId?: number;
  roleId?: number;
  roleName?: string | null;
  jobDescription?: string | null;
  profitRatio?: number;
  estimatedEarnings?: number;
  /** 0=open, 1=closed. */
  status?: number;
  [key: string]: unknown;
}
