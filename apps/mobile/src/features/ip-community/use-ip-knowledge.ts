import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import { api } from "@/lib/api-client";

type Answer = { answer: string; citedDocumentIds: string[]; unanswered: boolean };

export function useIpKnowledge(ipId: string) {
  const auth = useAuth(),
    gate = useAuthGate(),
    locale = useLocale(),
    t = useTranslations();
  const active = useScreenActive();
  const scope = useMemo(
    () => ({ ipId, locale, generation: auth.generation }),
    [ipId, locale, auth.generation]
  );
  const live = useRef<typeof scope | null>(null);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<{ controller: AbortController; scope: typeof scope } | null>(
    null
  );
  const [result, setResult] = useState<{
    scope: typeof scope;
    reply?: Answer;
    error?: string;
  } | null>(null);
  useLayoutEffect(() => {
    live.current = active ? scope : null;
    return () => {
      live.current = null;
      request.current?.abort();
      request.current = null;
    };
  }, [active, scope]);
  const current = () => live.current === scope && getAuthGeneration() === scope.generation;
  const cancel = () => {
    request.current?.abort();
    request.current = null;
    setBusy(null);
  };
  const ask = async (question: string) => {
    if (!current() || request.current || !question.trim() || question.trim().length > 1000) return;
    if (auth.status !== "authenticated") {
      gate.requireAuth();
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy({ controller, scope });
    setResult(null);
    const applicable = () =>
      current() && request.current === controller && !controller.signal.aborted;
    try {
      const reply = await api.post<Answer>(
        `/ip-commerce/ips/${encodeURIComponent(ipId)}/knowledge/ask`,
        {
          service: "aurora",
          data: { question: question.trim(), locale },
          timeout: 45_000,
          signal: controller.signal,
        }
      );
      if (applicable()) setResult({ scope, reply });
    } catch (error) {
      if (applicable())
        setResult({
          scope,
          error: error instanceof Error && error.message ? error.message : t("ipKnowledge.error"),
        });
    } finally {
      // A cancelled request may settle after its replacement has started.
      if (request.current === controller) {
        request.current = null;
        if (current()) setBusy(null);
      }
    }
  };
  return {
    ask,
    cancel,
    loading: active && busy?.scope === scope && !busy.controller.signal.aborted,
    answer: result?.scope === scope ? result.reply?.answer : undefined,
    citedIds: result?.scope === scope ? (result.reply?.citedDocumentIds ?? []) : [],
    error: result?.scope === scope ? result.error : undefined,
  };
}
