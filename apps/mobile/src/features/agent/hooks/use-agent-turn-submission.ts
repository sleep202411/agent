import { useCallback, useLayoutEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AgentOsSendExtras } from "./use-agent-os-session";
import { useStoryRequestScope } from "./use-story-request-scope";

export function useAgentTurnSubmission(options: {
  identity: string;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  getExtras: () => AgentOsSendExtras | undefined;
  commitExtras: (extras: AgentOsSendExtras) => void;
  send: (text: string, extras: AgentOsSendExtras) => Promise<boolean>;
  onStarted: () => void;
}) {
  const { identity, draft, setDraft, getExtras, commitExtras, send, onStarted } = options;
  const scope = useStoryRequestScope(identity);
  const active = useRef<typeof scope | null>(scope);
  const pending = useRef<object | null>(null);
  useLayoutEffect(() => {
    active.current = scope;
    return () => {
      active.current = null;
      pending.current = null;
    };
  }, [scope]);
  return useCallback(async () => {
    if (active.current !== scope || !scope.enabled || pending.current) return;
    const extras = getExtras();
    if (!extras || (!draft.trim() && !extras.attachmentIds?.length)) return;
    const operation = {};
    pending.current = operation;
    try {
      onStarted();
      const accepted = await send(draft.trim(), extras);
      if (!accepted || active.current !== scope || pending.current !== operation) return;
      commitExtras(extras);
      setDraft((current) => (current === draft ? "" : current));
    } finally {
      if (pending.current === operation) pending.current = null;
    }
  }, [scope, draft, setDraft, getExtras, commitExtras, send, onStarted]);
}
