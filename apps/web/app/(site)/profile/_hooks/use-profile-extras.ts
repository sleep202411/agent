/**
 * Profile-extras data layer — work experience + social-media links.
 *
 * Per-entry CRUD pattern (mirrors FAQ / Episode CRUD elsewhere): list
 * read + create + update + delete. Each list section on the profile
 * page has an "Add" button that opens a single-entry dialog; existing
 * rows expose inline edit / delete actions. Bulk-save UX is handled
 * in the dialog component, not here.
 *
 * **Endpoint URLs are placeholders.** Search for `TODO_BACKEND_URL`
 * before merging and replace each one with the real path the backend
 * exposes. The wire shape (JSON body via `data:`) matches the
 * existing `api.post` envelope so swapping is a one-line change per
 * URL constant.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";

// ─── Work experience ──────────────────────────────────
// Field names mirror the Java `/user/resumer/*` contract verbatim
// (`organization`, `startTime`, `endTime`) so payloads round-trip
// without per-field renaming on either side.

export interface ExperienceEntry {
  /** Optional id — undefined for new entries before the backend
   *  assigns one; required for update / delete calls. */
  id?: string | number;
  /** Job title / 头衔. */
  title: string;
  /** Company or organization name / 公司·组织. */
  organization: string;
  /** Free-form location / 地点. */
  location: string;
  /** YYYY-MM. */
  startTime: string;
  /** YYYY-MM. Empty / missing ⇒ ongoing role. */
  endTime?: string;
  /** Free text. Newlines preserved on render. */
  description: string;
}

// `/me` returns the current logged-in user's resume entries; the
// alternate `/list/{userId}` endpoint is for viewing another user's
// resume from public profile pages — not used on the self-profile.
const EXPERIENCE_LIST_URL = "/user/resumer/me";
const EXPERIENCE_CREATE_URL = "/user/resumer/add";
const EXPERIENCE_UPDATE_URL = "/user/resumer/update";
// Delete uses a path-param URL — built inline in useDeleteExperience.

async function fetchExperience(): Promise<ExperienceEntry[]> {
  const raw = await api.get<ExperienceEntry[] | { list?: ExperienceEntry[] }>(EXPERIENCE_LIST_URL);
  const list = Array.isArray(raw) ? raw : (raw?.list ?? []);
  return list.map(normalizeExperience);
}

function normalizeExperience(e: ExperienceEntry): ExperienceEntry {
  return {
    id: e?.id,
    title: typeof e?.title === "string" ? e.title : "",
    organization: typeof e?.organization === "string" ? e.organization : "",
    location: typeof e?.location === "string" ? e.location : "",
    startTime: typeof e?.startTime === "string" ? e.startTime : "",
    endTime: typeof e?.endTime === "string" ? e.endTime : "",
    description: typeof e?.description === "string" ? e.description : "",
  };
}

function trimmedExperience(e: ExperienceEntry): ExperienceEntry {
  return {
    ...(e.id !== undefined ? { id: e.id } : {}),
    title: e.title.trim(),
    organization: e.organization.trim(),
    location: e.location.trim(),
    startTime: e.startTime.trim(),
    endTime: (e.endTime ?? "").trim(),
    description: e.description.trim(),
  };
}

export const profileExtrasKeys = {
  all: ["profile-extras"] as const,
  experience: ["profile-extras", "experience"] as const,
  socials: ["profile-extras", "socials"] as const,
};

export function useExperience() {
  return useQuery<ExperienceEntry[]>({
    queryKey: profileExtrasKeys.experience,
    queryFn: fetchExperience,
  });
}

export function useCreateExperience() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: ExperienceEntry) =>
      api.post(EXPERIENCE_CREATE_URL, { data: trimmedExperience(entry) }),
    onSuccess: () => {
      return Promise.all([
        qc.invalidateQueries({ queryKey: profileExtrasKeys.experience }),
        qc.invalidateQueries({ queryKey: ["creator", "experience"] }),
      ]);
    },
  });
}

export function useUpdateExperience() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: ExperienceEntry) => {
      if (entry.id === undefined) throw new Error("update requires entry.id");
      return api.post(EXPERIENCE_UPDATE_URL, { data: trimmedExperience(entry) });
    },
    onSuccess: () => {
      return Promise.all([
        qc.invalidateQueries({ queryKey: profileExtrasKeys.experience }),
        qc.invalidateQueries({ queryKey: ["creator", "experience"] }),
      ]);
    },
  });
}

export function useDeleteExperience() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | number) =>
      api.post(`/user/resumer/delete/${encodeURIComponent(String(id))}`),
    onSuccess: () => {
      return Promise.all([
        qc.invalidateQueries({ queryKey: profileExtrasKeys.experience }),
        qc.invalidateQueries({ queryKey: ["creator", "experience"] }),
      ]);
    },
  });
}

// ─── Social-media links ───────────────────────────────

/**
 * Frontend-defined social platform IDs. Persisted on the wire — keep
 * stable across versions; renaming an id orphans existing entries.
 * Append to the list rather than reordering to add new platforms.
 */
export type SocialPlatform =
  | "twitter"
  | "weibo"
  | "wechat"
  | "bilibili"
  | "douyin"
  | "xiaohongshu"
  | "youtube"
  | "instagram"
  | "github"
  | "linkedin"
  | "website";

export interface SocialPlatformMeta {
  id: SocialPlatform;
  /** i18n key for the platform name — resolved at render time so the
   *  dropdown matches the user's locale. */
  labelKey: string;
  /** Hint placeholder for the URL input — guides users toward the
   *  expected handle / URL shape per platform. */
  placeholder: string;
}

/** Full platform list rendered in the dropdown, in display order. */
export const SOCIAL_PLATFORMS: SocialPlatformMeta[] = [
  { id: "twitter", labelKey: "socialPlatform_twitter", placeholder: "https://x.com/yourhandle" },
  { id: "weibo", labelKey: "socialPlatform_weibo", placeholder: "https://weibo.com/u/yourId" },
  { id: "wechat", labelKey: "socialPlatform_wechat", placeholder: "WeChat ID" },
  {
    id: "bilibili",
    labelKey: "socialPlatform_bilibili",
    placeholder: "https://space.bilibili.com/yourId",
  },
  {
    id: "douyin",
    labelKey: "socialPlatform_douyin",
    placeholder: "https://www.douyin.com/user/...",
  },
  {
    id: "xiaohongshu",
    labelKey: "socialPlatform_xiaohongshu",
    placeholder: "https://www.xiaohongshu.com/user/profile/...",
  },
  {
    id: "youtube",
    labelKey: "socialPlatform_youtube",
    placeholder: "https://youtube.com/@yourchannel",
  },
  {
    id: "instagram",
    labelKey: "socialPlatform_instagram",
    placeholder: "https://instagram.com/yourhandle",
  },
  { id: "github", labelKey: "socialPlatform_github", placeholder: "https://github.com/yourhandle" },
  {
    id: "linkedin",
    labelKey: "socialPlatform_linkedin",
    placeholder: "https://linkedin.com/in/yourhandle",
  },
  { id: "website", labelKey: "socialPlatform_website", placeholder: "https://yoursite.com" },
];

export interface SocialLink {
  /** Optional id when round-tripping persisted entries. */
  id?: string | number;
  platform: SocialPlatform;
  url: string;
}

/** Permissive parse of an unknown id back into a SocialPlatform. Falls
 *  back to "website" for anything we don't recognise so old entries
 *  still render under a sensible bucket instead of crashing. */
function coerceSocialPlatform(id: unknown): SocialPlatform {
  const known = SOCIAL_PLATFORMS.find((p) => p.id === id);
  return known ? known.id : "website";
}

const SOCIALS_LIST_URL = "/user/profile/socials/list"; // TODO_BACKEND_URL
const SOCIALS_CREATE_URL = "/user/profile/socials/create"; // TODO_BACKEND_URL
const SOCIALS_UPDATE_URL = "/user/profile/socials/update"; // TODO_BACKEND_URL
const SOCIALS_DELETE_URL = "/user/profile/socials/delete"; // TODO_BACKEND_URL

async function fetchSocials(): Promise<SocialLink[]> {
  const raw = await api.get<SocialLink[] | { list?: SocialLink[] }>(SOCIALS_LIST_URL);
  const arr = Array.isArray(raw) ? raw : (raw?.list ?? []);
  return arr.map((e) => ({
    id: e?.id,
    platform: coerceSocialPlatform(e?.platform),
    url: typeof e?.url === "string" ? e.url : "",
  }));
}

function trimmedSocial(e: SocialLink): SocialLink {
  return {
    ...(e.id !== undefined ? { id: e.id } : {}),
    platform: e.platform,
    url: e.url.trim(),
  };
}

export function useSocials() {
  return useQuery<SocialLink[]>({
    queryKey: profileExtrasKeys.socials,
    queryFn: fetchSocials,
  });
}

export function useCreateSocial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: SocialLink) => api.post(SOCIALS_CREATE_URL, { data: trimmedSocial(entry) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileExtrasKeys.socials });
    },
  });
}

export function useUpdateSocial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: SocialLink) => {
      if (entry.id === undefined) throw new Error("update requires entry.id");
      return api.post(SOCIALS_UPDATE_URL, { data: trimmedSocial(entry) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileExtrasKeys.socials });
    },
  });
}

export function useDeleteSocial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | number) => api.post(SOCIALS_DELETE_URL, { data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileExtrasKeys.socials });
    },
  });
}
