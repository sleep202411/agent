"use client";

/**
 * Two-step "synchronous" video gen for the per-episode editor.
 *
 * Endpoint: `POST /api/ai/video/generate/basic` (NOT the task-
 * based `/api/ai/task/video/generate/basic` — that one queues
 * asynchronously). The sync variant holds the HTTP connection
 * while the provider runs and returns the OSS path(s) inline.
 *
 * Two-step flow:
 *   1. POST sync gen → response envelope `{success, code,
 *      message, data: string[]}`. We omit `shotId` / `shotColumnId`
 *      so Java does NOT auto-persist; the result URL comes back
 *      on `data[0]` for us to handle on the client.
 *   2. POST `/api/user/shotValue/input` (`saveProduceShotValuesCell`)
 *      with the resolved path so the shot's video column is
 *      persisted. Failure here is recoverable — the credits were
 *      already spent in step 1; the user can hit save again
 *      without re-burning provider cost.
 *
 * Timeout matches `ai-lipsync-queue` — 6 minutes is the practical
 * ceiling for current providers.
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { backendApi } from "@/src/lib/api";
import { ossUrl } from "@/src/lib/asset-paths";
import { saveProduceShotValuesCell } from "@/src/lib/produce/java-produce-data";

const SYNC_VIDEO_ENDPOINT = "/api/ai/video/generate/basic";
const VIDEO_GEN_TIMEOUT_MS = 360_000;

export interface GenerateShotVideoParams {
  shotId: string;
  videoColumnId: string;
  prompt: string;
  startImagePath?: string;
  /** Seconds. Java expects a number on this endpoint; we coerce. */
  videoLength?: string | number;
  /** Optional model override — defaults to whatever Java picks. */
  modelId?: string;
  /** e.g. "1280x720". Optional. */
  size?: string;
  /** e.g. "16:9". Optional. */
  ratio?: string;
}

export interface UseGenerateShotVideoResult {
  generate: (params: GenerateShotVideoParams) => Promise<string | null>;
  generating: boolean;
  error: string | null;
}

/**
 * Pick the durable Java-relative path out of the wan2.6 sync-gen
 * response. The endpoint returns a 2-tuple
 * `[signedOssUrl, javaRelativePath]`:
 *
 *   [0] = "https://…oss-accelerate…?Expires=… &Signature=…"
 *   [1] = "history/vedio/62/2026-05-07/1778…mp4"
 *
 * The signed URL expires (typically 60-120 min); the relative path
 * survives forever and can be re-signed on demand via `ossUrl()`.
 * Persist the second one so the shot's video column keeps working
 * after the signature window closes.
 *
 * IMPORTANT: `backendApi.post` strips the Java envelope and returns
 * `body.data` directly — meaning the value passed to this function
 * is the *array itself*, NOT a `{data: [...]}` envelope. Earlier
 * callers that typed it as an envelope hit the bug where
 * `envelope.data` was always undefined and we lost the path.
 *
 * Shape handling, in priority order:
 *   - string         → use as-is
 *   - string[]       → prefer the non-http(s) entry, else first
 *   - {data: ...}    → defensive unwrap (in case `raw: true` ever
 *                       gets flipped on the call site)
 *   - anything else  → empty string
 */
function parseVideoPath(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (Array.isArray(input)) {
    const strings = input.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    );
    const durable = strings.find((s) => !/^https?:\/\//i.test(s));
    if (durable) return durable.trim();
    return strings[0]?.trim() ?? "";
  }
  if (input && typeof input === "object") {
    const inner = (input as { data?: unknown }).data;
    if (inner !== undefined) return parseVideoPath(inner);
  }
  return "";
}

function coerceLength(input: GenerateShotVideoParams["videoLength"]): number | undefined {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) return input;
  if (typeof input === "string") {
    const parsed = Number.parseInt(input, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export function useGenerateShotVideo(options?: {
  /** Called after both the sync gen and the column save succeed.
   *  Receives the resolved video storage path. */
  onSuccess?: (storagePath: string) => void;
}): UseGenerateShotVideoResult {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async ({
      shotId,
      videoColumnId,
      prompt,
      startImagePath,
      videoLength,
      modelId,
      size,
      ratio,
    }: GenerateShotVideoParams): Promise<string | null> => {
      if (!shotId || !videoColumnId) {
        toast.error("当前分镜缺少视频列。");
        return null;
      }
      if (!prompt.trim()) {
        toast.error("请先填写当前片段提示词。");
        return null;
      }

      setGenerating(true);
      setError(null);

      try {
        // Step 1 — sync video gen. Omit shotId / shotColumnId so
        // Java doesn't auto-persist; we'll save explicitly below.
        // backendApi unwraps the envelope and returns body.data
        // directly; for this endpoint that's a `[signedUrl, path]`
        // tuple. parseVideoPath handles both shapes (raw array OR
        // envelope) defensively.
        const result = await backendApi.post<unknown>(SYNC_VIDEO_ENDPOINT, {
          data: {
            prompt,
            startImageUrl: startImagePath ? ossUrl(startImagePath) : undefined,
            videoLength: coerceLength(videoLength),
            modelId: modelId || undefined,
            size: size || undefined,
            ratio: ratio || undefined,
          },
          timeout: VIDEO_GEN_TIMEOUT_MS,
        });
        console.log("[generate-shot-video] sync gen response:", result);
        const storagePath = parseVideoPath(result);
        if (!storagePath) {
          throw new Error(`视频生成未返回路径 (response: ${JSON.stringify(result).slice(0, 200)})`);
        }

        // Step 2 — persist into the shot's video column.
        await saveProduceShotValuesCell(shotId, videoColumnId, [storagePath]);

        toast.success("视频生成完成。");
        options?.onSuccess?.(storagePath);
        return storagePath;
      } catch (err) {
        const message = err instanceof Error ? err.message : "视频生成失败";
        setError(message);
        toast.error(message);
        return null;
      } finally {
        setGenerating(false);
      }
    },
    [options]
  );

  return { generate, generating, error };
}
