/**
 * IP detail — server-side fetchers for SSR JSON-LD.
 *
 * The interactive IP detail UI is a client component that fetches
 * via React Query. For schema.org / GEO purposes we additionally
 * server-fetch a minimal slice (project meta + FAQs) so the SSR HTML
 * carries the JSON-LD payload that AI crawlers read at first paint.
 *
 * These are best-effort — any failure (network, auth, malformed body)
 * silently returns null and the page renders without JSON-LD rather
 * than 500-ing. The interactive client side is unaffected either way.
 */

import "server-only";

import type { Project, FAQ } from "../../_hooks/types";

const CONTENT_BASE = (process.env.JAVA_CONTENT_URL ?? "https://fizzdragon.com/content").replace(
  /\/+$/,
  ""
);

interface JavaEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
}

async function postForm<T>(path: string, body: Record<string, string>): Promise<T | null> {
  try {
    const params = new URLSearchParams(body);
    const res = await fetch(`${CONTENT_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as JavaEnvelope<T>;
    if (json.code !== 0 && json.code !== 200) return null;
    return json.data ?? null;
  } catch {
    return null;
  }
}

export async function fetchProjectDetailServer(projectId: string): Promise<Project | null> {
  return postForm<Project>("/project/query", { projectId });
}

export async function fetchProjectFaqsServer(projectId: string): Promise<FAQ[]> {
  // Endpoint is GET /project/faq/list?projectId= — see _hooks/use-faqs.ts.
  // Returns array directly or `{ list: [] }` depending on backend version.
  try {
    const url = new URL(`${CONTENT_BASE}/project/faq/list`);
    url.searchParams.set("projectId", projectId);
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const json = (await res.json()) as JavaEnvelope<FAQ[] | { list?: FAQ[] }>;
    if (json.code !== 0 && json.code !== 200) return [];
    const data = json.data;
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.list ?? [];
  } catch {
    return [];
  }
}
