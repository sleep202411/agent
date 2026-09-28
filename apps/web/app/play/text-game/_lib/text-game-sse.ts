import {
  TEXT_GAME_STREAM_TIMEOUT_MS,
  takeTextGameSseFrames,
  textGameStreamErrorMessage,
  type TextGameSseFrame,
} from "@repo/shared/text-game";
import { ApiRequestError, notifyUnauthorized } from "@/src/lib/api";

function studioApiUrl(path: string): string {
  const prefix = process.env.NEXT_PUBLIC_API_STUDIO_PREFIX ?? "";
  return `${prefix}${path}`;
}

function satokenHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const match = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
  return match ? { satoken: decodeURIComponent(match[1]) } : {};
}

function throwIfJavaEnvelope(raw: string, status: number): void {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const code = body.code;
    const isUnauth = code === 401 || code === "401" || code === 302 || code === "302";
    if (isUnauth) notifyUnauthorized();
    const isSuccess = body.success === true || code === 200 || code === "SUCCESS";
    if (isSuccess) return;
    throw new ApiRequestError(
      (code as string | number | undefined) ?? "UNKNOWN",
      typeof body.msg === "string" && body.msg.trim()
        ? body.msg
        : typeof body.message === "string" && body.message.trim()
          ? body.message
          : "Request failed",
      isUnauth ? 401 : status || 200,
      raw
    );
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
  }
  if (status && status !== 200) {
    if (status === 401) notifyUnauthorized();
    throw new ApiRequestError(`HTTP_${status}`, raw.trim() || `HTTP ${status}`, status, raw);
  }
}

export async function readTextGameSse(
  path: string,
  body: unknown,
  onFrame: (frame: TextGameSseFrame) => void,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), TEXT_GAME_STREAM_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancelReader = () => {
    void reader?.cancel().catch(() => {});
  };
  controller.signal.addEventListener("abort", cancelReader, { once: true });
  try {
    let response: Response;
    try {
      response = await fetch(studioApiUrl(path), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...satokenHeader(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      controller.signal.throwIfAborted();
      throw new ApiRequestError("NETWORK_ERROR", "Network connection failed", 0);
    }
    controller.signal.throwIfAborted();
    reader = response.body?.getReader();
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream") || !response.ok || !response.body) {
      let raw = "";
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) {
            raw += decoder.decode();
            break;
          }
          raw += decoder.decode(value, { stream: true });
        }
      }
      controller.signal.throwIfAborted();
      throwIfJavaEnvelope(raw, response.status);
      throw new ApiRequestError(
        `HTTP_${response.status}`,
        raw.trim() || `HTTP ${response.status}`,
        response.status,
        raw
      );
    }

    if (!reader)
      throw new ApiRequestError("STREAM_ERROR", "Missing response body", response.status);
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      controller.signal.throwIfAborted();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = takeTextGameSseFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        controller.signal.throwIfAborted();
        if (frame.event === "error") {
          throw new ApiRequestError(
            "STREAM_ERROR",
            textGameStreamErrorMessage(frame.data, "Request failed"),
            200,
            JSON.stringify(frame.data)
          );
        }
        onFrame(frame);
        if (frame.event === "done") return;
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (controller.signal.aborted) {
      throw new ApiRequestError("NETWORK_ERROR", "Request timed out", 0);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", cancelReader);
    cancelReader();
    reader?.releaseLock();
  }
}
