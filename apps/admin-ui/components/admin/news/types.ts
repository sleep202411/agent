/**
 * News module domain types (admin-ui).
 *
 * Mirrors the legacy admin_web 资讯 model but on the platform's BCP-47 locales
 * (zh-CN / en-US / zh-HK, matching IP taxonomy) instead of the old cn/hk/en
 * short codes. Field-level i18n: title / summary / body / cover / video are
 * per-locale; kind / url / author / status / publishedAt / tags are shared.
 *
 * Backend wiring is intentionally deferred — the panel operates on local state
 * seeded with the samples below so the UI/UX is reviewable end-to-end. When the
 * `/api/admin/news` endpoints land, swap the in-memory mutations for envelope
 * calls (see the TODO in news-panel.tsx).
 */

/** Content locales a published article should carry (zh-CN is primary). */
export const NEWS_LOCALES = [
  { code: "zh-CN", short: "简", label: "简体中文", primary: true },
  { code: "en-US", short: "EN", label: "English", primary: false },
  { code: "zh-HK", short: "繁", label: "繁體中文", primary: false },
] as const;

export type NewsLocaleCode = (typeof NEWS_LOCALES)[number]["code"];

export const NEWS_PRIMARY_LOCALE: NewsLocaleCode = "zh-CN";

/** Internal article (own detail page) vs external link (opens a third-party URL). */
export type NewsKind = "article" | "external";

/** Draft (hidden) · Published (live) · Offline (kept but hidden). */
export type NewsStatus = "draft" | "published" | "offline";

/** Per-locale editorial content. Body is only meaningful for internal articles. */
export interface NewsLocaleContent {
  title: string;
  summary: string;
  body: string;
  coverUrl: string;
  videoUrl: string;
}

export interface NewsTag {
  id: string;
  label: Record<NewsLocaleCode, string>;
}

export interface NewsArticle {
  id: string;
  kind: NewsKind;
  /** External link — shared across locales; only used when kind === "external". */
  url: string;
  author: string;
  status: NewsStatus;
  tagIds: string[];
  /** ISO timestamp; required before an article can go to "published". */
  publishedAt: string | null;
  localized: Record<NewsLocaleCode, NewsLocaleContent>;
  createdAt: string;
  updatedAt: string;
}

export function emptyNewsLocaleContent(): NewsLocaleContent {
  return { title: "", summary: "", body: "", coverUrl: "", videoUrl: "" };
}

export function emptyLocalizedContent(): Record<NewsLocaleCode, NewsLocaleContent> {
  return {
    "zh-CN": emptyNewsLocaleContent(),
    "en-US": emptyNewsLocaleContent(),
    "zh-HK": emptyNewsLocaleContent(),
  };
}

/** Whether a locale carries enough content to count as "translated". */
export function isLocaleFilled(content: NewsLocaleContent, kind: NewsKind): boolean {
  if (!content.title.trim()) return false;
  if (kind === "article" && !content.body.trim()) return false;
  return true;
}

export function newsStatusLabel(status: NewsStatus): string {
  return status === "published" ? "已发布" : status === "offline" ? "已下线" : "草稿";
}

export function newsStatusTone(status: NewsStatus): "success" | "muted" | "warn" {
  return status === "published" ? "success" : status === "offline" ? "warn" : "muted";
}

export function newsKindLabel(kind: NewsKind): string {
  return kind === "external" ? "外部链接" : "内部文章";
}

// ---------------------------------------------------------------------------
// Sample seed — placeholder data so the list + editor render for review.
// Replace with `fetchAdminNews()` once the backend exists.
// ---------------------------------------------------------------------------

export const SAMPLE_NEWS_TAGS: NewsTag[] = [
  { id: "product", label: { "zh-CN": "产品动态", "en-US": "Product", "zh-HK": "產品動態" } },
  { id: "industry", label: { "zh-CN": "行业洞察", "en-US": "Industry", "zh-HK": "行業洞察" } },
  { id: "tutorial", label: { "zh-CN": "教程", "en-US": "Tutorial", "zh-HK": "教程" } },
  { id: "event", label: { "zh-CN": "活动", "en-US": "Event", "zh-HK": "活動" } },
  { id: "press", label: { "zh-CN": "媒体报道", "en-US": "Press", "zh-HK": "媒體報導" } },
];

export const SAMPLE_NEWS: NewsArticle[] = [
  {
    id: "n_launch_studio",
    kind: "article",
    url: "",
    author: "FizzDragon 运营组",
    status: "published",
    tagIds: ["product", "event"],
    publishedAt: "2026-06-12T02:00:00.000Z",
    createdAt: "2026-06-10T09:00:00.000Z",
    updatedAt: "2026-06-12T02:00:00.000Z",
    localized: {
      "zh-CN": {
        title: "FizzStudio 正式上线：从灵感到成片的一站式创作",
        summary: "全新统一创作台整合图像、视频与画布工作流，让团队在同一空间内完成生产。",
        body: "## 一站式创作\n\nFizzStudio 把图像、视频、画布与协作整合到一个工作区……",
        coverUrl: "https://picsum.photos/seed/fizzstudio/640/360",
        videoUrl: "",
      },
      "en-US": {
        title: "FizzStudio is live: from idea to final cut in one place",
        summary:
          "The unified creation hub brings image, video and canvas workflows into a single space.",
        body: "## One creative surface\n\nFizzStudio unifies image, video, canvas and collaboration……",
        coverUrl: "https://picsum.photos/seed/fizzstudio/640/360",
        videoUrl: "",
      },
      "zh-HK": {
        title: "",
        summary: "",
        body: "",
        coverUrl: "",
        videoUrl: "",
      },
    },
  },
  {
    id: "n_seedance",
    kind: "article",
    url: "",
    author: "FizzDragon 运营组",
    status: "draft",
    tagIds: ["product", "tutorial"],
    publishedAt: null,
    createdAt: "2026-06-15T06:30:00.000Z",
    updatedAt: "2026-06-16T01:10:00.000Z",
    localized: {
      "zh-CN": {
        title: "Seedance 2.0 接入：原生同步音频的视频生成",
        summary: "新增 ByteDance Seedance 2.0 视频模型，支持首尾帧与全模态参考。",
        body: "我们已接入 Seedance 2.0……",
        coverUrl: "https://picsum.photos/seed/seedance/640/360",
        videoUrl: "",
      },
      "en-US": { title: "", summary: "", body: "", coverUrl: "", videoUrl: "" },
      "zh-HK": { title: "", summary: "", body: "", coverUrl: "", videoUrl: "" },
    },
  },
  {
    id: "n_external_variety",
    kind: "external",
    url: "https://variety.com/2026/digital/news/ai-video-generation",
    author: "Variety",
    status: "published",
    tagIds: ["industry", "press"],
    publishedAt: "2026-06-08T12:00:00.000Z",
    createdAt: "2026-06-08T12:00:00.000Z",
    updatedAt: "2026-06-08T12:00:00.000Z",
    localized: {
      "zh-CN": {
        title: "Variety：AI 视频生成进入主流制作流程",
        summary: "外媒报道 AI 视频工具如何重塑短片与广告制作。",
        body: "",
        coverUrl: "https://picsum.photos/seed/variety/640/360",
        videoUrl: "",
      },
      "en-US": {
        title: "Variety: AI video generation enters mainstream production",
        summary: "How AI video tools are reshaping short-form and advertising production.",
        body: "",
        coverUrl: "https://picsum.photos/seed/variety/640/360",
        videoUrl: "",
      },
      "zh-HK": { title: "", summary: "", body: "", coverUrl: "", videoUrl: "" },
    },
  },
];
