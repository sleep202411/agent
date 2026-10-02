import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IpAccess, IpDetail } from "@/data/types";
import { loadPlaybackDetail } from "./load-playback-detail";
import { resolvePlaybackEntry, type PlaybackEntry } from "./playback-entry";

/** Public detail survives a return visit, but viewer access must be rechecked.
 * A response from before blur, account change or a newer read cannot restore it. */
export function usePlaybackDetail(
  id: string,
  watch: string | undefined,
  episode: string | undefined,
  active: boolean
) {
  const [ip, setIp] = useState<IpDetail>();
  const [access, setAccess] = useState<IpAccess>();
  const [accessError, setAccessError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessBusy, setAccessBusy] = useState(active);
  const [playing, setPlaying] = useState<PlaybackEntry>();
  const aliveRef = useRef(false);
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);
  const revision = useRef(0);

  const invalidate = useCallback(() => {
    revision.current++;
  }, []);
  const [activeScope, setActiveScope] = useState(active);
  if (activeScope !== active) {
    setActiveScope(active);
    setAccess(undefined);
    setPlaying(undefined);
    setAccessBusy(active);
  }

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      invalidate();
    };
  }, [invalidate]);

  const isCurrent = useCallback(
    (version: number) => aliveRef.current && activeRef.current && version === revision.current,
    []
  );
  const load = useCallback(
    (resume = false) => {
      if (!aliveRef.current || !activeRef.current) return Promise.resolve(undefined);
      const version = ++revision.current;
      return loadPlaybackDetail(id)
        .then(
          (result) => {
            if (!isCurrent(version)) return undefined;
            setIp(result.detail);
            setAccess(result.access);
            setAccessError(result.accessError);
            if (resume && result.detail) {
              setPlaying(resolvePlaybackEntry(result.detail, result.access, watch, episode));
            }
            return result;
          },
          (error: unknown) => {
            if (isCurrent(version)) setAccessError(error instanceof Error ? error.message : "");
            return undefined;
          }
        )
        .finally(() => {
          if (isCurrent(version)) {
            setLoading(false);
            setAccessBusy(false);
          }
        });
    },
    [id, watch, episode, isCurrent]
  );

  const refresh = useCallback(
    (resume = false) => {
      if (!aliveRef.current || !activeRef.current) return Promise.resolve(undefined);
      setAccessBusy(true);
      setAccess(undefined);
      setPlaying(undefined);
      return load(resume);
    },
    [load]
  );

  useEffect(() => {
    if (active) void load(true);
    return invalidate;
  }, [active, load, invalidate]);

  return {
    ip,
    setIp,
    access: active ? access : undefined,
    accessError,
    loading,
    accessBusy,
    playing: active ? playing : undefined,
    setPlaying,
    refresh,
    aliveRef,
    revision,
    isCurrent,
  };
}
