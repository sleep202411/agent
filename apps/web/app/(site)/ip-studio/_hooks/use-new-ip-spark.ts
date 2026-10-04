"use client";

import { useMutation } from "@tanstack/react-query";
import { extractFriendlyErrorMessage } from "@/src/lib/error-message";

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

  try {
    let res: Response;
    try {
      res = await fetch("/aurora/spark/analyze", {
        method: "POST",
        credentials: "include",
        body: formData,
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw new Error("Analysis timed out");
      throw new Error("Network connection failed");
    }
    if (!res.ok) {
      const message = extractFriendlyErrorMessage(await res.text());
      throw new Error(`HTTP ${res.status}${message ? ` — ${message}` : ""}`);
    }

    const body = (await res.json()) as {
      code?: number;
      success?: boolean;
      msg?: string;
      message?: string;
      data?: NewIpSparkDraft | null;
    };
    if (controller.signal.aborted) throw new Error("Analysis timed out");
    const ok = body.success === true || body.code === 0 || body.code === 200;
    if (!ok) throw new Error(body.msg || body.message || "Analysis failed");
    return body.data ?? {};
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Analysis timed out");
    throw error;
  } finally {
    // Fetch resolves at headers; keep the deadline through body consumption.
    clearTimeout(timer);
  }
}

export function useNewIpSparkAnalyze() {
  return useMutation({ mutationFn: analyzeNewIpBrief });
}
