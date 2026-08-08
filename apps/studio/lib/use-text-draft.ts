"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_DEBOUNCE_MS = 800;

export interface TextDraft {
  value: string;
  onChange: (next: string) => void;
  /** Commit the pending draft now (blur, submit, unmount). */
  flush: () => void;
}

/**
 * A locally-rendered text draft committed on a trailing debounce — the saving
 * discipline for collaborative text fields.
 *
 * Typing renders from local state so the caret never jumps (a value echoing
 * back through the document mid-keystroke is what breaks IME composition),
 * while the document takes at most one write per pause. A peer's edit is
 * adopted only while this field is CLEAN, never on top of what someone is
 * typing; concurrent edits to the same field then merge last-write-wins, which
 * is the documented v1 granularity. Unmounting flushes, so a row deleted or
 * navigated away from never eats the last keystrokes.
 */
export function useTextDraft(
  remote: string,
  commit: (next: string) => void,
  debounceMs = DEFAULT_DEBOUNCE_MS
): TextDraft {
  const [draft, setDraft] = useState(remote);
  const dirtyRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const commitRef = useRef(commit);

  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  useEffect(() => {
    if (dirtyRef.current) return;
    setDraft(remote);
  }, [remote]);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = pendingRef.current;
    pendingRef.current = null;
    dirtyRef.current = false;
    if (next !== null) commitRef.current(next);
  }, []);

  useEffect(() => () => flush(), [flush]);

  const onChange = useCallback(
    (next: string) => {
      dirtyRef.current = true;
      pendingRef.current = next;
      setDraft(next);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        flush();
      }, debounceMs);
    },
    [debounceMs, flush]
  );

  return { value: draft, onChange, flush };
}
