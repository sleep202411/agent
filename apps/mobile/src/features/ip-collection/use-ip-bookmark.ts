import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
const Collection = z.object({
  items: z.array(
    z
      .object({
        targetType: z.string(),
        status: z.string(),
        ipId: z.string().optional(),
        ip: z.object({ id: z.string() }).optional(),
        episodeId: z.string().nullable().optional(),
        episode: z.object({ id: z.string() }).nullable().optional(),
      })
      .refine(
        (item) => item.targetType !== "ip" || Boolean(item.ipId ?? item.ip?.id),
        "Collection item is missing its IP identity."
      )
  ),
});
type State = { key: string; busy: boolean; known: boolean; saved: boolean; error?: string };
type Session = {
  key: string;
  controller: AbortController;
  busy: boolean;
  known: boolean;
  saved: boolean;
};
/** A failed write is uncertain: always read before permitting another mutation. */
export function useIpBookmark(
  generation: number,
  viewerId: string | null,
  locale: string,
  ipId: string | null,
  enabled: boolean,
  episodeId: string | null = null
) {
  const key = JSON.stringify([generation, viewerId, locale, ipId, episodeId, enabled]);
  const owner = useRef<Session | null>(null);
  const [state, setState] = useState<State>();
  const current = (s: Session) =>
    owner.current === s && !s.controller.signal.aborted && getAuthGeneration() === generation;
  const publish = (s: Session, error?: string) => {
    if (current(s)) setState({ key: s.key, busy: s.busy, known: s.known, saved: s.saved, error });
  };
  const read = async (s: Session, writeError?: string) => {
    if (!current(s)) return;
    s.busy = true;
    s.known = false;
    publish(s, writeError);
    let error = writeError;
    try {
      const data = Collection.parse(
        await api.get("/ip-commerce/me/collection", {
          service: "aurora",
          credentials: "include",
          params: { locale },
          retry: false,
          signal: s.controller.signal,
        })
      );
      if (!current(s)) return;
      s.saved = data.items.some(
        (item) =>
          item.status === "active" &&
          (item.ipId ?? item.ip?.id) === ipId &&
          (episodeId
            ? item.targetType === "episode" && (item.episodeId ?? item.episode?.id) === episodeId
            : item.targetType === "ip" && !item.episodeId && !item.episode)
      );
      s.known = true;
    } catch (e) {
      error = [writeError, e instanceof Error ? e.message : String(e)].filter(Boolean).join("\n");
    } finally {
      s.busy = false;
      publish(s, error);
    }
  };
  useEffect(() => {
    if (!enabled || !viewerId || !ipId) return;
    const s: Session = {
      key,
      controller: new AbortController(),
      busy: false,
      known: false,
      saved: false,
    };
    owner.current = s;
    queueMicrotask(() => {
      void read(s);
    });
    return () => {
      s.controller.abort();
      if (owner.current === s) owner.current = null;
    };
    // The complete operation scope is encoded in key. Ordinary rerenders preserve the read/write lock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const toggle = async () => {
    const s = owner.current;
    if (!s || s.key !== key || !current(s) || s.busy || !s.known || !enabled || !viewerId || !ipId)
      return;
    s.busy = true;
    publish(s);
    let error: string | undefined;
    try {
      await api.post(s.saved ? "/ip-commerce/me/collection/remove" : "/ip-commerce/me/collection", {
        service: "aurora",
        credentials: "include",
        retry: false,
        signal: s.controller.signal,
        data: episodeId ? { targetType: "episode", ipId, episodeId } : { targetType: "ip", ipId },
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (current(s)) await read(s, error);
  };
  const value = enabled && state?.key === key ? state : undefined;
  return {
    saved: value?.known ? value.saved : false,
    busy: value?.busy ?? Boolean(enabled && viewerId && ipId),
    known: value?.known ?? false,
    error: value?.error,
    toggle,
    retry: () => {
      const s = owner.current;
      if (s && s.key === key && current(s) && !s.busy) void read(s);
    },
  };
}
