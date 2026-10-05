"use client";
import { useEffect, useRef, useState } from "react";
import {
  DiscoveryAssistantRequestSchema,
  DiscoveryAssistantReceiptSchema,
  type DiscoveryAssistantRequest,
  type DiscoveryAssistantReceipt,
  type DiscoveryAssistantResult,
} from "@repo/shared/discovery-assistant";
import { api, ApiRequestError } from "@/src/lib/api";

type Current = DiscoveryAssistantRequest["conversation"]["current"];
type Message = DiscoveryAssistantRequest["conversation"]["messages"][number];
const path = "/aurora/content-gps/discovery/requests";

/** The surface keys this hook by viewer/locale/mode. Only explicit actions
 * dispatch work; mounting/recovery never starts a model turn. */
export function useDiscoveryAssistant(input: {
  viewerId: string | null;
  locale: DiscoveryAssistantRequest["locale"];
  current: Current;
  onProposal?: (result: Extract<DiscoveryAssistantResult, { status: "results" }>) => void;
  copy: {
    storage: string;
    mismatch: string;
    invalid: string;
    resultSummary: (count: number) => string;
  };
}) {
  const { viewerId, locale, current, copy } = input;
  const key = `discovery-assistant:${viewerId}:${locale}:${current.kind}`;
  const [request, setRequest] = useState<DiscoveryAssistantRequest | null>(null);
  const [receipt, setReceipt] = useState<DiscoveryAssistantReceipt | null>(null);
  const [history, setHistory] = useState<Message[]>([]);
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [denied, setDenied] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const stored = viewerId ? sessionStorage.getItem(key) : null;
        if (stored) {
          const parsed = DiscoveryAssistantRequestSchema.parse(JSON.parse(stored));
          if (parsed.locale !== locale || parsed.conversation.current.kind !== current.kind)
            throw new Error(copy.mismatch);
          setRequest(parsed);
          setHistory(parsed.conversation.messages);
        }
        setReady(true);
      } catch {
        setError(copy.storage);
      }
      setBusy(false);
    });
    return () => {
      active = false;
      mounted.current = false;
      operation.current?.abort();
    };
    // Caller keys by viewer/locale/mode; query changes preserve the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function failure(cause: unknown) {
    setReceipt(null);
    setError(cause instanceof Error ? cause.message : String(cause));
    if (cause instanceof ApiRequestError && [401, 403].includes(cause.status)) {
      setDenied(true);
      setHistory([]);
      setRequest(null);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Never restore an unauthorized transcript. */
      }
    }
  }
  function accept(raw: unknown, expected: DiscoveryAssistantRequest) {
    const checked = DiscoveryAssistantReceiptSchema.safeParse(raw);
    if (!checked.success) throw new Error(copy.mismatch);
    const parsed = checked.data;
    if (
      parsed.requestId !== expected.requestId ||
      (parsed.result?.status === "results" &&
        (parsed.result.kind !== expected.conversation.current.kind ||
          (parsed.result.kind === "ips" && parsed.result.query.locale !== locale)))
    )
      throw new Error(copy.mismatch);
    setReceipt(parsed);
    setMissing(false);
    if (parsed.result) {
      const content =
        parsed.result.status === "clarification"
          ? parsed.result.question
          : copy.resultSummary(parsed.result.matchedCount);
      setHistory([...expected.conversation.messages, { role: "assistant", content }]);
      if (parsed.result.status === "results") input.onProposal?.(parsed.result);
    }
  }
  async function execute(action: "send" | "check" | "cancel", next: DiscoveryAssistantRequest) {
    if (!viewerId || denied || (operation.current && action !== "cancel")) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    setReceipt(null);
    setMissing(false);
    try {
      const raw =
        action === "check"
          ? await api.get(`${path}/${next.requestId}`, {
              signal: controller.signal,
              timeout: 60_000,
            })
          : await api.post(action === "send" ? path : `${path}/${next.requestId}/cancel`, {
              data: action === "send" ? next : {},
              signal: controller.signal,
              timeout: 60_000,
            });
      if (!controller.signal.aborted && mounted.current) accept(raw, next);
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) {
        if (action === "check" && cause instanceof ApiRequestError && cause.status === 404)
          setMissing(true);
        failure(cause);
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }
  const canSend = Boolean(
    viewerId &&
    ready &&
    !denied &&
    !busy &&
    (!request || receipt?.status === "succeeded" || receipt?.status === "cancelled")
  );
  async function send(text: string) {
    if (!canSend || operation.current) return false;
    let next: DiscoveryAssistantRequest;
    try {
      const parsed = DiscoveryAssistantRequestSchema.safeParse({
        requestId: crypto.randomUUID(),
        locale,
        conversation: { current, messages: [...history, { role: "user", content: text }] },
      });
      if (!parsed.success) {
        setError(copy.invalid);
        return false;
      }
      next = parsed.data;
      // A stored exact request is required before dispatch; never silently send
      // unrecoverable work when browser storage is unavailable.
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      setError(copy.storage);
      return false;
    }
    setRequest(next);
    setHistory(next.conversation.messages);
    await execute("send", next);
    return true;
  }
  async function check() {
    if (request) await execute("check", request);
  }
  async function retryMissing() {
    if (request && missing && !busy) await execute("send", request);
  }
  async function cancel() {
    if (request) await execute("cancel", request);
  }
  function reset() {
    if (busy || (request && !receipt)) return;
    if (receipt?.status === "dispatched") return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      setError(copy.storage);
      return;
    }
    // A successful explicit reset also recovers failed storage hydration.
    // send() still persists the exact new request before making an API call.
    setReady(true);
    setRequest(null);
    setReceipt(null);
    setHistory([]);
    setMissing(false);
    setError(null);
  }
  return {
    request,
    receipt,
    history,
    busy,
    error,
    missing,
    denied,
    canSend,
    send,
    check,
    retryMissing,
    cancel,
    reset,
  };
}
