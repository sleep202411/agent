/**
 * Spark — AI-assisted IP draft generator.
 *
 *   - `useSparkAnalyze`     — POST /api/ai/chat/analyze/project-brief
 *                             (multipart: file)  →  SparkDraft
 *   - `useSparkGenerateBanner` — POST /api/ai/chat/generate/project-banner
 *                                (json: { prompt, projectId }) → bannerLink (OSS key)
 *
 * Both endpoints are owned by the agent backend. The UI flow is
 * deliberately "AI proposes, user disposes": the analyze call returns a
 * structured draft that the dialog renders as per-field checkable
 * suggestions; nothing is persisted until the user clicks Save in the
 * underlying edit form. Banner generation is opt-in and runs as a
 * separate step inside the dialog.
 */

import { useMutation } from "@tanstack/react-query";

/** Fields the analyzer is willing to propose. Every field is optional —
 *  the user might upload a brief that only mentions some of them. */
export interface SparkDraft {
  name?: string;
  description?: string;
  background?: string;
  story?: string;
  whyThisIP?: string;
  tags?: string[];
  /** Suggested image-generation prompt the user can run separately. */
  bannerPrompt?: string;
}

async function analyzeBrief(file: File): Promise<SparkDraft> {
  const formData = new FormData();
  formData.append("file", file);
  const controller = new AbortController();
  // Brief analysis can take a while on a long PDF — a generous client
  // timeout is friendlier than a confusing AbortError.
  const timer = setTimeout(() => controller.abort(), 300_000);
  let res: Response;
  try {
    res = await fetch("/api/ai/chat/analyze/project-brief", {
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
  if (!ok) throw new Error(body.msg || body.message || "Generation failed");
  const data = body.data;
  if (!data) throw new Error("Empty response");
  if (typeof data === "string") return data;
  return data.bannerLink ?? data.path ?? "";
}

export function useSparkGenerateBanner() {
  return useMutation({ mutationFn: generateBanner });
}
