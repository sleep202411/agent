"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useAdminSessionRequests } from "./admin-session-boundary";

/** New reads replace old reads; a mutation excludes all overlapping work. */
export function useAdminOperation() {
  const scope = useAdminSessionRequests();
  const active = useRef(false);
  const pending = useRef<{
    kind: "read" | "write";
    lease: NonNullable<ReturnType<typeof scope.begin>>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current?.lease.cancel();
      pending.current = null;
    };
  }, [scope]);
  const begin = useCallback(
    (kind: "read" | "write" = "write") => {
      if (!active.current || pending.current?.kind === "write") return null;
      pending.current?.lease.cancel();
      const lease = scope.begin();
      if (!lease) return null;
      const operation = { kind, lease };
      pending.current = operation;
      setBusy(true);
      return {
        signal: lease.signal,
        cancel: () => lease.cancel(),
        current: () => active.current && pending.current === operation && lease.current(),
        finish: () => {
          lease.release();
          if (pending.current === operation) {
            pending.current = null;
            if (active.current) setBusy(false);
          }
        },
      };
    },
    [scope]
  );
  return { busy, begin };
}
