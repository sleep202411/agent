import { useEffect, useRef } from "react";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";

/** Same best-effort signal as Web TV. Eligibility and monthly deduplication
 * belong to the server; a signal never grants access or proves settlement. */
export function useMemberView(
  episode: { ipId: string; episodeId: string } | undefined,
  playing: boolean
) {
  const auth = useAuth();
  const sent = useRef(new Set<string>());
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  const ipId = episode?.ipId,
    episodeId = episode?.episodeId;
  const period = new Date().toISOString().slice(0, 7);
  useEffect(() => {
    if (
      !playing ||
      !ipId ||
      !episodeId ||
      !userId ||
      auth.status !== "authenticated" ||
      auth.generation !== getAuthGeneration()
    )
      return;
    const key = JSON.stringify([auth.generation, userId, ipId, episodeId, period]);
    if (sent.current.has(key)) return;
    const controller = new AbortController();
    sent.current.add(key);
    void api
      .post<{ recorded: boolean }>("/ip-commerce/member-views", {
        service: "aurora",
        data: { ipId, episodeId },
        signal: controller.signal,
        retry: false,
      })
      .then((result) => {
        if (!result.recorded) sent.current.delete(key);
      })
      .catch(() => {
        // A later playback/resume may retry; never interrupt the film for telemetry.
        sent.current.delete(key);
      });
    return () => controller.abort();
  }, [playing, ipId, episodeId, userId, auth.status, auth.generation, period]);
}
