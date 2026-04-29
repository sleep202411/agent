/**
 * IP feature config + detail-page UI types.
 *
 * Hooks / fetchers / response types live in `_hooks/`. This module is for:
 *   - dictionaries used by IP forms (PROJECT_TYPES, SUGGESTED_TAGS)
 *   - the slim `IPDetail` shape the detail page renders into (a frontend
 *     blend of real backend data + per-field mock fallback)
 */

// ─── Detail-page UI shape ────────────────────────────
//
// Detail page composes data from several backend reads (project query,
// members, episodes, FAQs) plus mock fallback for fields the backend
// doesn't expose yet (story / whyThisIP / updates / tagline). Keep the
// interface narrow — only the fields the page actually renders.

export interface IPTeamMember {
  name: string;
  role: string;
  avatar: string;
  level: string;
  projects: number;
  rating: number;
  certified?: boolean;
}

export interface IPUpdate {
  date: string;
  title: string;
  content: string;
}

export interface IPFAQ {
  q: string;
  a: string;
}

export interface IPDetail {
  id: string;
  title: string;
  cover: string;
  tagline: string;
  story: string;
  whyThisIP: string;
  tags: string[];
  team: IPTeamMember[];
  updates: IPUpdate[];
  faqs: IPFAQ[];
}

export const EMPTY_IP_DETAIL: IPDetail = {
  id: "",
  title: "",
  cover: "",
  tagline: "",
  story: "",
  whyThisIP: "",
  tags: [],
  team: [],
  updates: [],
  faqs: [],
};

// ─── Form dictionaries ───────────────────────────────

export const PROJECT_TYPES = [
  "ipDevelopment",
  "series",
  "brandShort",
  "commercial",
  "creativeExperiment",
] as const;

export const SUGGESTED_TAGS = [
  "AI动画",
  "AI绘画",
  "赛博朋克",
  "奇幻",
  "科幻",
  "日常",
  "动作",
  "悬疑",
  "治愈",
  "国风",
  "机甲",
  "末日",
  "校园",
  "恋爱",
] as const;
