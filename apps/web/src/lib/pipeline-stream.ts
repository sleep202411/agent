import type { PipelineEvent } from "@/src/types/workspace";

export type { PipelineEvent };

export function pipelineStream(
  path: string,
  data: Record<string, unknown>,
  handlers?: {
    onEvent?: (event: PipelineEvent) => void;
    onDone?: (completed: boolean) => void;
    onError?: (error: unknown) => void;
  }
) {
  const controller = new AbortController();

  fetch(`/aurora${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ...data, stream: true }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (controller.signal.aborted) {
        await response.body?.cancel().catch(() => undefined);
        return;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      let ended = false;
      const onAbort = () => {
        void reader.cancel().catch(() => undefined);
      };
      controller.signal.addEventListener("abort", onAbort, { once: true });
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) return;
          if (done) {
            ended = true;
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() ?? "";

          for (const line of parts) {
            if (controller.signal.aborted) return;
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;

            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") {
              completed = true;
              continue;
            }

            let event: PipelineEvent;
            try {
              event = JSON.parse(payload) as PipelineEvent;
              if (event === null) throw new Error("Empty pipeline event");
            } catch {
              event = { type: "partial", content: payload };
            }
            if (event.type === "done" || event.type === "pipeline_complete") completed = true;
            handlers?.onEvent?.(event);
          }
        }

        if (!controller.signal.aborted) handlers?.onDone?.(completed);
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
        try {
          if (!ended) await reader.cancel();
        } catch {
          // Preserve the original read/callback error during detached-stream cleanup.
        } finally {
          reader.releaseLock();
        }
      }
    })
    .catch((error) => {
      if (controller.signal.aborted || (error as { name?: string })?.name === "AbortError") return;
      handlers?.onError?.(error);
    });

  return () => controller.abort();
}
