"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import {
  CopilotHistoryContractError,
  CopilotHistoryRemoteError,
  copilotResponseError,
  parseCopilotHistoryPayload,
  type CopilotHistoryPayload,
} from "./copilot-history";

const COPILOT_HISTORY_API = "/aurora/copilot/history";

export type CopilotHistoryStatus = "loading" | "ready" | "error";

interface CopilotHistoryState {
  scopeKey: string;
  status: CopilotHistoryStatus;
  error: Error | null;
  payload: CopilotHistoryPayload | null;
  resetting: boolean;
}

const COPILOT_HISTORY_POLL_MS = 750;
const COPILOT_RESET_API = "/aurora/copilot/reset";

export function useCopilotHistory<UI_MESSAGE extends UIMessage>({
  conversationId,
  workspaceId,
  mode,
  projectId,
  setMessages,
  onLoaded,
}: {
  conversationId: string;
  workspaceId: string | null;
  mode?: string;
  projectId?: string;
  setMessages: (messages: UI_MESSAGE[]) => void;
  onLoaded?: (payload: CopilotHistoryPayload<UI_MESSAGE>) => void;
}) {
  const scopeKey = `${workspaceId ?? "anonymous"}:${mode ?? "copilot"}:${projectId ?? "none"}:${conversationId}`;
  const scopeKeyRef = useRef(scopeKey);
  useLayoutEffect(() => {
    scopeKeyRef.current = scopeKey;
  }, [scopeKey]);
  const [state, setState] = useState<CopilotHistoryState>(() => ({
    scopeKey,
    status: "loading",
    error: null,
    payload: null,
    resetting: false,
  }));
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const resetAbortRef = useRef<AbortController | null>(null);
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  const load = useCallback(
    async (
      options: { resetting?: boolean; apply?: boolean } = {}
    ): Promise<CopilotHistoryPayload<UI_MESSAGE> | null> => {
      if (scopeKeyRef.current !== scopeKey) return null;
      const requestId = ++requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState((current) => ({
        scopeKey,
        status: "loading",
        error: null,
        payload: current.scopeKey === scopeKey ? current.payload : null,
        resetting: options.resetting ?? false,
      }));

      try {
        for (;;) {
          const response = await fetch(COPILOT_HISTORY_API, {
            method: "POST",
            credentials: "include",
            headers: requestHeaders(workspaceId),
            body: JSON.stringify({
              conversationId,
              ...(mode ? { mode } : {}),
              ...(projectId ? { projectId } : {}),
            }),
            signal: controller.signal,
          });
          if (!response.ok) throw await copilotResponseError(response);
          const payload = parseCopilotHistoryPayload<UI_MESSAGE>(await response.json());
          if (
            controller.signal.aborted ||
            requestId !== requestIdRef.current ||
            scopeKeyRef.current !== scopeKey
          )
            return null;
          if (payload.conversationId !== conversationId) {
            throw new CopilotHistoryContractError();
          }
          if (options.apply !== false) {
            setMessages(payload.messages);
            onLoadedRef.current?.(payload);
            setState({
              scopeKey,
              status: payload.status === "streaming" ? "loading" : "ready",
              error: null,
              payload,
              resetting: options.resetting ?? false,
            });
          }
          if (payload.status !== "streaming") return payload;
          await abortableDelay(COPILOT_HISTORY_POLL_MS, controller.signal);
        }
      } catch (caught) {
        if (
          controller.signal.aborted ||
          requestId !== requestIdRef.current ||
          scopeKeyRef.current !== scopeKey
        )
          return null;
        setState({
          scopeKey,
          status: "error",
          // Only upstream messages are actionable and safe to show verbatim.
          // Local contract/network failures use the caller's localized fallback.
          error: caught instanceof CopilotHistoryRemoteError ? caught : null,
          payload: null,
          resetting: options.resetting ?? false,
        });
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [conversationId, mode, projectId, scopeKey, setMessages, workspaceId]
  );

  const reset = useCallback(async (): Promise<boolean> => {
    if (resetAbortRef.current || scopeKeyRef.current !== scopeKey) return false;
    const controller = new AbortController();
    resetAbortRef.current = controller;
    const active = () => !controller.signal.aborted && scopeKeyRef.current === scopeKey;
    try {
      // The CAS snapshot is authoritative input for the reset request, not a
      // state transition. Applying it here could overwrite a local draft,
      // selected Skill, or pending-turn recovery before reset completion is
      // proven by the post-reset canonical reload.
      const snapshot = await load({ resetting: true, apply: false });
      if (!active() || !snapshot || snapshot.status === "streaming") return false;
      const response = await fetch(COPILOT_RESET_API, {
        signal: controller.signal,
        method: "POST",
        credentials: "include",
        headers: requestHeaders(workspaceId),
        body: JSON.stringify({
          conversationId,
          expectedRevision: snapshot.revision,
          expectedSessionId: snapshot.sessionId,
          ...(mode ? { mode } : {}),
          ...(projectId ? { projectId } : {}),
        }),
      });
      if (!active()) return false;
      if (!response.ok) throw await copilotResponseError(response);
      // A successful delete is not proof that the conversation is still empty:
      // another tab can create the next session before this response arrives.
      // Reload canonical state and let its new session/revision win.
      const canonical = await load({ resetting: true });
      return active() && canonical !== null;
    } catch (caught) {
      if (!active()) return false;
      await load({ resetting: true });
      if (!active()) return false;
      setState((current) => ({
        ...current,
        error: caught instanceof CopilotHistoryRemoteError ? caught : null,
        resetting: false,
      }));
      return false;
    } finally {
      if (resetAbortRef.current === controller) {
        resetAbortRef.current = null;
        if (active()) setState((current) => ({ ...current, resetting: false }));
      }
    }
  }, [conversationId, load, mode, projectId, scopeKey, workspaceId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      resetAbortRef.current?.abort();
      resetAbortRef.current = null;
      requestIdRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [load]);

  return {
    status: state.scopeKey === scopeKey ? state.status : "loading",
    error: state.scopeKey === scopeKey ? state.error : null,
    conversationStatus:
      state.scopeKey === scopeKey ? (state.payload?.status ?? "streaming") : "streaming",
    revision: state.scopeKey === scopeKey ? (state.payload?.revision ?? 0) : 0,
    sessionId: state.scopeKey === scopeKey ? (state.payload?.sessionId ?? null) : null,
    resetting: state.scopeKey === scopeKey ? state.resetting : false,
    payload:
      state.scopeKey === scopeKey
        ? (state.payload as CopilotHistoryPayload<UI_MESSAGE> | null)
        : null,
    retry: load,
    reset,
  } as const;
}

function requestHeaders(workspaceId: string | null): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(workspaceId ? { "x-fizz-workspace-id": workspaceId } : {}),
  };
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
