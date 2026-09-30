import { useEffect, useEffectEvent, useState } from "react";
import { openInboxRealtime } from "./inbox-realtime";
export function useInboxRealtime(
  userId: string | undefined,
  generation: number,
  active: boolean,
  refresh: () => void
) {
  const [failedScope, setFailedScope] = useState<string>();
  const scope = JSON.stringify([userId, generation]);
  const onRefresh = useEffectEvent(refresh);
  useEffect(() => {
    if (!active || !userId) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    const close = openInboxRealtime(
      userId,
      generation,
      () => {
        if (!live) return;
        setFailedScope(undefined);
        if (pending) return;
        pending = setTimeout(() => {
          pending = undefined;
          if (live) onRefresh();
        }, 250);
      },
      () => {
        if (live) setFailedScope(scope);
      }
    );
    return () => {
      live = false;
      if (pending) clearTimeout(pending);
      close();
    };
  }, [userId, generation, active, scope]);
  return active && failedScope === scope;
}
