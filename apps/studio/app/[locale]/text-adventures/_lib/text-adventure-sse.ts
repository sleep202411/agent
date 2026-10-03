import {
  TEXT_GAME_STREAM_TIMEOUT_MS,
  takeTextGameSseFrames,
  textGameStreamErrorMessage,
  type TextGameSseFrame,
} from "@repo/shared/text-game";
import { ApiRequestError } from "@/lib/api";

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
    if (isUnauth && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("fizz:unauthorized"));
    }
    const numericCode = typeof code === "number" ? code : null;
    const isSuccess =
      body.success === true ||
      (numericCode !== null && numericCode >= 200 && numericCode < 300) ||
      code === "SUCCESS";
    if (isSuccess) return;
    throw new ApiRequestError(
      (typeof code === "string" || typeof code === "number" ? code : undefined) ?? "UNKNOWN",
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
    if (status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("fizz:unauthorized"));
    }
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
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TEXT_GAME_STREAM_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(path, {
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
    } catch (error) {
      signal?.throwIfAborted();
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      throw new ApiRequestError(
        "NETWORK_ERROR",
        timedOut ? "Request timed out" : "Network connection failed",
        0
      );
    }

    signal?.throwIfAborted();
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const raw = await response.text();
      signal?.throwIfAborted();
      throwIfJavaEnvelope(raw, response.status);
      throw new ApiRequestError(
        `HTTP_${response.status}`,
        raw.trim() || `HTTP ${response.status}`,
        response.status,
        raw
      );
    }

    if (!response.ok || !response.body) {
      const raw = await response.text().catch(() => "");
      signal?.throwIfAborted();
      throwIfJavaEnvelope(raw, response.status);
      throw new ApiRequestError(
        `HTTP_${response.status}`,
        raw.trim() || `HTTP ${response.status}`,
        response.status,
        raw
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        signal?.throwIfAborted();
        if (done) {
          completed = true;
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = takeTextGameSseFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          if (frame.event === "error") {
            throw new ApiRequestError(
              "STREAM_ERROR",
              textGameStreamErrorMessage(frame.data, "Request failed"),
              200,
              JSON.stringify(frame.data)
            );
          }
          signal?.throwIfAborted();
          onFrame(frame);
        }
      }
    } finally {
      if (!completed) {
        // Cancel without waiting on a potentially stalled upstream cleanup.
        void reader.cancel().catch(() => undefined);
        controller.abort();
      }
      reader.releaseLock();
    }
  } catch (error) {
    if (timedOut) {
      throw new ApiRequestError("NETWORK_ERROR", "Request timed out", 0);
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    clearTimeout(timer);
  }
}
