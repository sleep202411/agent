import "server-only";

/** Anonymous regional reads only: never forward the visitor's session to SEO. */
export async function readPublicContent(
  base: "SERVER_URL" | "JAVA_CONTENT_URL",
  path: string,
  signal?: AbortSignal
): Promise<unknown> {
  const origin = process.env[base]?.trim();
  if (!origin) throw new Error(`Missing required environment variable: ${base}`);
  const response = await fetch(`${origin.replace(/\/+$/, "")}${path}`, {
    cache: "no-store",
    credentials: "omit",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Public content returned HTTP ${response.status}`);
  const envelope = await response.json();
  if (
    !envelope ||
    typeof envelope !== "object" ||
    (envelope.success !== true && envelope.code !== 200) ||
    envelope.success === false ||
    (envelope.code !== undefined && envelope.code !== 200 && envelope.code !== "SUCCESS")
  ) {
    throw new Error("Public content returned an unsuccessful envelope");
  }
  return envelope.data;
}

export interface PublicCourseSeo {
  id: number;
  title: string;
  description: string;
}
export async function readPublicCourse(
  id: string,
  locale: string
): Promise<PublicCourseSeo | null> {
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) return null;
  try {
    const value = await readPublicContent(
      "JAVA_CONTENT_URL",
      `/project/courses/${id}?locale=${encodeURIComponent(locale)}`
    );
    if (!value || typeof value !== "object") return null;
    const course = value as Record<string, unknown>;
    if (
      (course.status !== undefined && course.status !== "published") ||
      course.deletedAt != null ||
      course.id !== Number(id) ||
      typeof course.title !== "string" ||
      !course.title.trim() ||
      typeof course.description !== "string"
    )
      return null;
    return { id: course.id as number, title: course.title, description: course.description };
  } catch {
    return null;
  }
}

export interface PublicDiscoveryEntry {
  path: string;
  updated?: Date;
}
function entry(path: string, updated: unknown): PublicDiscoveryEntry {
  const date = typeof updated === "string" ? new Date(updated) : null;
  return { path, ...(date && Number.isFinite(date.getTime()) ? { updated: date } : {}) };
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const positiveId = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export async function discoverPublicContent(
  kind: "ips" | "news" | "courses",
  locale: string
): Promise<PublicDiscoveryEntry[]> {
  const entries = new Map<string, PublicDiscoveryEntry>();
  const cursors = new Set<string>();
  let cursor = "";
  const deadline = AbortSignal.timeout(20_000);
  // Stay below the 50,000 URL sitemap limit across kinds/locales. A repeated
  // cursor/page is an upstream fault, not permission to loop indefinitely.
  for (let page = 1; page <= 100; page++) {
    const path =
      kind === "ips"
        ? `/ip-commerce/ips?locale=${locale}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
        : kind === "news"
          ? `/api/news?locale=${locale}&page=${page}&pageSize=50`
          : `/project/courses?locale=${locale}`;
    const data = await readPublicContent(
      kind === "ips" ? "SERVER_URL" : "JAVA_CONTENT_URL",
      path,
      deadline
    );
    const body = record(data);
    const items = kind === "courses" ? data : kind === "ips" ? body.items : body.list;
    if (!Array.isArray(items)) throw new Error(`Invalid public ${kind} list`);
    if (items.length > 5000) throw new Error("Public course sitemap exceeds its page budget");
    for (const raw of items) {
      const item = record(raw);
      if (kind === "ips") {
        if (
          item.status !== "published" ||
          item.listingVisibility !== "public" ||
          typeof item.id !== "string" ||
          !/^[a-f\d-]{36}$/i.test(item.id)
        )
          continue;
      } else {
        if (!positiveId(item.id) || (kind === "news" && item.kind === "external")) continue;
        // Public Java endpoints select published records; reject explicit
        // contradictory state if a future projection adds these fields.
        if (item.status !== undefined && item.status !== "published") continue;
        if (item.deletedAt != null) continue;
      }
      const url = `/${kind}/${item.id}`;
      entries.set(url, entry(url, item.updateTime ?? item.updatedAt ?? item.publishedAt));
    }
    if (kind === "courses") return [...entries.values()];
    if (kind === "ips") {
      if (body.nextCursor == null) return [...entries.values()];
      if (typeof body.nextCursor !== "string" || !body.nextCursor || cursors.has(body.nextCursor))
        throw new Error("Public IP pagination did not advance");
      cursor = body.nextCursor;
      cursors.add(cursor);
    } else if (items.length < 50) return [...entries.values()];
    // An all-external News page is valid, so do not use filtered count for termination.
    if (page === 100)
      throw new Error(`Public ${kind} sitemap exceeds its page budget; split the sitemap`);
  }
  return [...entries.values()];
}
