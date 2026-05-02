/**
 * Spark — AI-assisted IP draft generator.
 *
 *   - `useSparkAnalyze` — POST /aurora/spark/analyze (multipart: file)
 *                          → SparkDraft { name, description, tags }
 *
 * Owned by the Nest agent backend (`/aurora/*` is proxied to
 * `SERVER_URL` in `next.config.ts`). Field set is intentionally narrow:
 * Spark proposes `name` / `description` / `tags`, the user reviews +
 * edits in the dialog, and the dialog itself commits via
 * `useUpdateProject`. No persisted state lives here.
 *
 * Banner generation, story / whyThisIP / background fields are out of
 * scope for now — the backend doesn't support them. Reintroduce as
 * sibling hooks when those endpoints land.
 */

import { useMutation } from "@tanstack/react-query";

/** Subset of IP fields the analyzer is willing to propose. Every field
 *  is optional — the user might upload a brief that only mentions some
 *  of them. `bannerPrompt` is internal and never shown verbatim to the
 *  user; the dialog hands it to the banner generator on demand. */
export interface SparkDraft {
  name?: string;
  description?: string;
  tags?: string[];
  bannerPrompt?: string;
}

/** Limit picked to be friendly for typical novel/script uploads while
 *  still bounding worst-case parse cost. Files above this should be
 *  rejected client-side with a clear error. */
export const SPARK_MAX_BYTES = 20 * 1024 * 1024;

async function analyzeBrief(file: File): Promise<SparkDraft> {
  const formData = new FormData();
  formData.append("file", file);
  const controller = new AbortController();
  // Brief analysis can take a while on a long PDF — a generous client
  // timeout is friendlier than a confusing AbortError.
  const timer = setTimeout(() => controller.abort(), 300_000);
  let res: Response;
  try {
    res = await fetch("/aurora/spark/analyze", {
      method: "POST",
      credentials: "include",
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    throw new Error(isTimeout ? "Analysis timed out" : "Network connection failed");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as {
    code?: number;
    success?: boolean;
    msg?: string;
    message?: string;
    data?: SparkDraft | null;
  };
  const ok = body.success === true || body.code === 0 || body.code === 200;
  if (!ok) throw new Error(body.msg || body.message || "Analysis failed");
  return body.data ?? {};
}

export function useSparkAnalyze() {
  return useMutation({ mutationFn: analyzeBrief });
}

// ─── Banner generator ────────────────────────────────
//
// Goes direct to Java's existing `/api/ai/chat/generate/project-banner`
// endpoint (the same one used by the legacy publish flow). Returns the
// OSS path Spark dialog plugs into the project's `bannerLink` field on
// Apply. We don't proxy through Nest because Java already owns image
// generation, OSS upload, and billing attribution — adding a hop would
// only mean another place that can fail.

interface GenerateBannerInput {
  projectId: string | number;
  prompt: string;
}

async function generateBanner(input: GenerateBannerInput): Promise<string> {
  const res = await fetch("/api/ai/chat/generate/project-banner", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: Number(input.projectId),
      prompt: input.prompt,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as {
    code?: number;
    success?: boolean;
    msg?: string;
    message?: string;
    data?: string | { bannerLink?: string; path?: string } | null;
  };
  const ok = body.success === true || body.code === 0 || body.code === 200;
  if (!ok) throw new Error(body.msg || body.message || "Banner generation failed");
  const data = body.data;
  if (!data) throw new Error("Empty banner response");
  if (typeof data === "string") return data;
  return data.bannerLink ?? data.path ?? "";
}

export function useSparkGenerateBanner() {
  return useMutation({ mutationFn: generateBanner });
}
