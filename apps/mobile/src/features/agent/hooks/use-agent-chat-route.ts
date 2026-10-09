import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SetStateAction } from "react";
import { useStoryRequestScope } from "./use-story-request-scope";

/** Route-owned draft and one-shot query intent, independent of live run renders. */
export function useAgentChatRoute(options: {
  projectId: string;
  chapterId?: string;
  workbenchMode: string;
  configured: boolean;
  query: string;
  prefill: string;
  send: (text: string) => Promise<boolean>;
  restore: () => Promise<void>;
}) {
  const { projectId, chapterId, workbenchMode, configured, query, prefill, send, restore } =
    options;
  const identity = JSON.stringify([projectId, chapterId, workbenchMode]);
  const scope = useStoryRequestScope(identity);
  const active = useRef<typeof scope | null>(scope);
  const actions = useRef({ send, restore });
  const consumedQueries = useRef(new Set<string>());
  const [draft, setDraftState] = useState(prefill);
  const [previous, setPrevious] = useState({ scope, identity, prefill, revision: 0 });
  if (previous.scope !== scope || previous.prefill !== prefill) {
    setPrevious({ scope, identity, prefill, revision: previous.revision + 1 });
    // A new destination can carry its own prefill; credential changes must not
    // reintroduce the old account's route draft.
    setDraftState(
      previous.scope !== scope && (previous.identity === identity || previous.prefill === prefill)
        ? ""
        : prefill
    );
  }
  useLayoutEffect(() => {
    actions.current = { send, restore };
  }, [send, restore]);
  useLayoutEffect(() => {
    active.current = scope;
    return () => {
      active.current = null;
    };
  }, [scope]);
  const setDraft = useCallback(
    (value: SetStateAction<string>) => {
      if (active.current === scope) setDraftState(value);
    },
    [scope]
  );

  useEffect(() => {
    if (!configured || !scope.enabled) return;
    let cancelled = false;
    // Defer admission until after cleanup can discard StrictMode's first setup.
    void Promise.resolve().then(() => {
      if (cancelled || active.current !== scope) return;
      const queryKey = JSON.stringify([projectId, query]);
      if (query && !consumedQueries.current.has(queryKey)) {
        consumedQueries.current.add(queryKey);
        void actions.current.send(query).then((accepted) => {
          if (!accepted && !cancelled && active.current === scope)
            setDraftState((current) => current || query);
        });
      } else {
        void actions.current.restore();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scope, configured, projectId, query]);

  return { draft, setDraft, scrollResetKey: `${identity}:${previous.revision}` };
}
