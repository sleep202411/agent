import type { PlaySessionReporter } from "@repo/experience-engine";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";

/** A reporter belongs to the viewer that started the public film. */
export function createPlaySessionReporter(generation: number): PlaySessionReporter {
  const current = () => {
    if (generation !== getAuthGeneration()) throw new Error("Playback account changed.");
  };
  const post = async <T>(action: string, data: unknown): Promise<T> => {
    current();
    const result = await api.post<T>(`/api/player/play/sessions/${action}`, {
      service: "studio",
      data,
    });
    current();
    return result;
  };
  return {
    async onStart(payload) {
      const result = await post<{ sessionId?: unknown }>("start", payload);
      if (!result || typeof result.sessionId !== "string" || !result.sessionId.trim())
        throw new Error("Invalid play session response.");
      return { sessionId: result.sessionId };
    },
    async onProgress(sessionId, payload) {
      if (sessionId) await post("progress", { sessionId, ...payload });
    },
    async onComplete(sessionId, payload) {
      if (sessionId) await post("complete", { sessionId, ...payload });
    },
  };
}
