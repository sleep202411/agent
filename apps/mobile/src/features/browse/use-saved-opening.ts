import { useEffect, useRef, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { readSavedOpening, setSavedOpening } from "./saved-openings-api";
type State = { key: string; busy: boolean; known: boolean; saved: boolean; error?: string };
type Session = {
  key: string;
  controller: AbortController;
  busy: boolean;
  known: boolean;
  saved: boolean;
};
/** A failed write is uncertain: always read before permitting another mutation. */
export function useSavedOpening(
  generation: number,
  viewerId: string | null,
  locale: string,
  positionId: string | null,
  enabled: boolean
) {
  const key = JSON.stringify([generation, viewerId, locale, positionId, enabled]);
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
      const saved = await readSavedOpening(
        { userId: viewerId!, generation },
        positionId!,
        s.controller.signal
      );
      if (!current(s)) return;
      s.saved = saved;
      s.known = true;
    } catch (e) {
      error = [writeError, e instanceof Error ? e.message : String(e)].filter(Boolean).join("\n");
    } finally {
      s.busy = false;
      publish(s, error);
    }
  };
  useEffect(() => {
    if (!enabled || !viewerId || !positionId) return;
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
    if (
      !s ||
      s.key !== key ||
      !current(s) ||
      s.busy ||
      !s.known ||
      !enabled ||
      !viewerId ||
      !positionId
    )
      return;
    s.busy = true;
    publish(s);
    let error: string | undefined;
    try {
      await setSavedOpening(
        { userId: viewerId, generation },
        positionId,
        !s.saved,
        s.controller.signal
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (current(s)) await read(s, error);
  };
  const value = enabled && state?.key === key ? state : undefined;
  return {
    saved: value?.known ? value.saved : false,
    busy: value?.busy ?? Boolean(enabled && viewerId && positionId),
    known: value?.known ?? false,
    error: value?.error,
    toggle,
    retry: () => {
      const s = owner.current;
      if (s && s.key === key && current(s) && !s.busy) void read(s);
    },
  };
}
