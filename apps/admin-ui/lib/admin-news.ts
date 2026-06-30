/**
 * Server-side client for the Java 资讯 (news) backend `/api/admin/news`,
 * implemented on the fizzdragon Java app (com.fizzdragon, `final` branch).
 *
 * Reached via NEWS_API_BASE_URL — the fizzdragon Java backend lives under the
 * /content path prefix, so the base must include it:
 *   .com → https://java.fizzdragon.com/content
 *   .cn  → https://java.fizzspace.cn/content
 * (full URL e.g. https://java.fizzdragon.com/content/api/admin/news). Hitting
 * the apex without /content routes to a different Sa-Token service → 302
 * "Not logged in!". Authenticated with a custom Admin API token header
 * (X-Admin-Api-Token), SEPARATE from the Nest admin session cookie used by
 * lib/admin-api.ts — so this is a distinct client, not a reuse of that one.
 *
 * NEWS_API_TOKEN is a server-only secret. This module must NEVER be imported
 * into a client component; client mutations go through the
 * app/api/admin/news/* route handlers, which call into here.
 *
 * Contract: docs/news-module-backend-spec.md + the Java team's as-built
 * docs/admin-news-api.md. Envelope { code, msg, data }, code === 200 = ok.
 * Update is PUT /api/admin/news/{id} — matches the deployed @PutMapping; the
 * Java doc text says POST, but the controller code is the source of truth.
 */
import type {
  NewsArticle,
  NewsKind,
  NewsLocaleCode,
  NewsLocaleContent,
  NewsStatus,
  NewsTag,
} from "@/components/admin/news/types";

const TOKEN_HEADER = process.env.NEWS_API_TOKEN_HEADER?.trim() || "X-Admin-Api-Token";

function newsApiBaseUrl(): string {
  const base = process.env.NEWS_API_BASE_URL?.trim();
  if (base) return base.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return "https://java.fizzdragon.com/content";
  throw new Error("Missing NEWS_API_BASE_URL (the Java 资讯 backend origin).");
}

function newsApiToken(): string {
  const token = process.env.NEWS_API_TOKEN?.trim();
  if (token) return token;
  throw new Error("Missing NEWS_API_TOKEN (X-Admin-Api-Token for the Java 资讯 backend).");
}

async function newsFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${newsApiBaseUrl()}/api/admin/news${path}`, {
    ...init,
    headers: {
      [TOKEN_HEADER]: newsApiToken(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

async function newsData<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    data?: T;
  } | null;
  if (!response.ok || !payload || payload.code !== 200) {
    throw new Error(payload?.msg ?? `资讯服务请求失败：${response.status}`);
  }
  return payload.data as T;
}

// --- Java wire shapes (envelope.data) ---
interface JavaLocale {
  title?: string | null;
  summary?: string | null;
  body?: string | null;
  coverUrl?: string | null;
  videoUrl?: string | null;
  url?: string | null;
}
interface JavaNews {
  id: number;
  kind: NewsKind;
  url?: string | null;
  author?: string | null;
  status: NewsStatus;
  tagIds?: string[] | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  localized?: Record<string, JavaLocale> | null;
}
interface JavaNewsListData {
  list: JavaNews[];
  stats: AdminNewsStats;
  total: number;
}
interface JavaNewsTag {
  id: string;
  label?: Record<string, string> | null;
}

// --- mapping: Java -> admin-ui domain ---
function toLocaleContent(java?: JavaLocale | null): NewsLocaleContent {
  return {
    title: java?.title ?? "",
    summary: java?.summary ?? "",
    body: java?.body ?? "",
    coverUrl: java?.coverUrl ?? "",
    videoUrl: java?.videoUrl ?? "",
    url: java?.url ?? "",
  };
}

function toArticle(java: JavaNews): NewsArticle {
  const localized = java.localized ?? {};
  const localizedContent = {
    "zh-CN": toLocaleContent(localized["zh-CN"]),
    "en-US": toLocaleContent(localized["en-US"]),
    "zh-HK": toLocaleContent(localized["zh-HK"]),
  };
  return {
    id: String(java.id),
    kind: java.kind,
    // External link is stored per-locale (localized.<locale>.url); the shared
    // article.url is a convenience for the list card — derive it from the primary
    // locale, falling back to any locale or the legacy top-level field.
    url:
      localizedContent["zh-CN"].url ||
      localizedContent["en-US"].url ||
      localizedContent["zh-HK"].url ||
      (java.url ?? ""),
    author: java.author ?? "",
    status: java.status,
    tagIds: java.tagIds ?? [],
    publishedAt: java.publishedAt ?? null,
    localized: localizedContent,
    createdAt: java.createdAt,
    updatedAt: java.updatedAt,
  };
}

function toTag(java: JavaNewsTag): NewsTag {
  const label = java.label ?? {};
  return {
    id: java.id,
    label: {
      "zh-CN": label["zh-CN"] ?? "",
      "en-US": label["en-US"] ?? "",
      "zh-HK": label["zh-HK"] ?? "",
    },
  };
}

// --- public types ---
export interface AdminNewsStats {
  total: number;
  published: number;
  draft: number;
  incompleteTranslation: number;
}
export interface AdminNewsListData {
  items: NewsArticle[];
  stats: AdminNewsStats;
  total: number;
}
export interface NewsLoadResult<T> {
  data: T | null;
  error: string | null;
}
/** Create/update payload (admin-ui -> Java). Mirrors the article minus server fields. */
export interface AdminNewsSaveInput {
  kind: NewsKind;
  url: string;
  author: string;
  status: NewsStatus;
  tagIds: string[];
  publishedAt: string | null;
  localized: NewsArticle["localized"];
}

function toQuery(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "资讯服务请求失败。";
}

// --- reads (server components) ---
export async function fetchAdminNewsList(
  params?: Record<string, string | undefined>
): Promise<NewsLoadResult<AdminNewsListData>> {
  try {
    const data = await newsData<JavaNewsListData>(await newsFetch(toQuery(params)));
    return {
      data: { items: (data.list ?? []).map(toArticle), stats: data.stats, total: data.total },
      error: null,
    };
  } catch (error) {
    return { data: null, error: errorMessage(error) };
  }
}

export async function fetchAdminNewsDetail(id: string): Promise<NewsLoadResult<NewsArticle>> {
  try {
    const data = await newsData<JavaNews>(await newsFetch(`/${encodeURIComponent(id)}`));
    return { data: toArticle(data), error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error) };
  }
}

export async function fetchAdminNewsTags(): Promise<NewsLoadResult<NewsTag[]>> {
  try {
    const data = await newsData<JavaNewsTag[]>(await newsFetch("/tags"));
    return { data: (data ?? []).map(toTag), error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error) };
  }
}

// --- writes (called from route handlers; throw on failure) ---
export async function createAdminNews(input: AdminNewsSaveInput): Promise<string> {
  const response = await newsFetch("", { method: "POST", body: JSON.stringify(input) });
  // Create returns `id` at the envelope ROOT (not in `data`).
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    id?: number | string;
  } | null;
  if (!response.ok || !payload || payload.code !== 200) {
    throw new Error(payload?.msg ?? `新建资讯失败：${response.status}`);
  }
  return String(payload.id ?? "");
}

export async function updateAdminNews(id: string, input: AdminNewsSaveInput): Promise<void> {
  await newsData<unknown>(
    await newsFetch(`/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) })
  );
}

export async function deleteAdminNews(id: string): Promise<void> {
  await newsData<unknown>(await newsFetch(`/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

// --- tag CRUD (Java: POST /tags, PUT /tags/{tagId}) ---
export interface AdminNewsTagSaveInput {
  /** Optional on create (auto-derived from the en-US label); ignored on update. */
  id?: string;
  label: Record<NewsLocaleCode, string>;
  /** 1 = enabled (default), 0 = disabled. */
  status?: number;
}

export async function createAdminNewsTag(input: AdminNewsTagSaveInput): Promise<string> {
  const response = await newsFetch("/tags", { method: "POST", body: JSON.stringify(input) });
  // Create returns `id` at the envelope ROOT (not in `data`).
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    id?: string;
  } | null;
  if (!response.ok || !payload || payload.code !== 200) {
    throw new Error(payload?.msg ?? `新建标签失败：${response.status}`);
  }
  return String(payload.id ?? "");
}

export async function updateAdminNewsTag(
  tagId: string,
  input: AdminNewsTagSaveInput
): Promise<void> {
  await newsData<unknown>(
    await newsFetch(`/tags/${encodeURIComponent(tagId)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    })
  );
}
