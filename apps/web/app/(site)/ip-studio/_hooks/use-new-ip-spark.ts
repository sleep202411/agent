"use client";

import { useMutation } from "@tanstack/react-query";

export interface NewIpSparkDraft {
  name?: string;
  description?: string;
  tags?: string[];
  textRef?: string;
  sourceChars?: number;
  sourceExcerpt?: string;
}

async function analyzeNewIpBrief(file: File): Promise<NewIpSparkDraft> {
  const formData = new FormData();
  formData.append("file", file);
  const controller = new AbortController();
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
    data?: NewIpSparkDraft | null;
  };
  const ok = body.success === true || body.code === 0 || body.code === 200;
  if (!ok) throw new Error(body.msg || body.message || "Analysis failed");
  return body.data ?? {};
}

export function useNewIpSparkAnalyze() {
  return useMutation({ mutationFn: analyzeNewIpBrief });
}
