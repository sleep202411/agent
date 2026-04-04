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
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";

        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            completed = true;
            continue;
          }

          try {
            const event = JSON.parse(payload) as PipelineEvent;
            if (event.type === "done" || event.type === "pipeline_complete") {
              completed = true;
            }
            handlers?.onEvent?.(event);
          } catch {
            handlers?.onEvent?.({ type: "partial", content: payload });
          }
        }
      }

      handlers?.onDone?.(completed);
    })
    .catch((error) => {
      if ((error as { name?: string })?.name === "AbortError") return;
      handlers?.onError?.(error);
    });

  return () => controller.abort();
}
