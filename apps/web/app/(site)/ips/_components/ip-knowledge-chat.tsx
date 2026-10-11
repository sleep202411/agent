"use client";

import { useState, useRef, useEffect } from "react";
import { IconSparkles, IconSend, IconX, IconFileText, IconAlertCircle } from "@tabler/icons-react";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";

interface IpKnowledgeChatProps {
  ipId: string;
}

export function IpKnowledgeChat({ ipId }: IpKnowledgeChatProps) {
  const t = useTranslations("ipKnowledge");
  const rawLocale = useLocale();
  const locale = rawLocale === "en-US" || rawLocale === "zh-HK" ? rawLocale : "zh-CN";
  const { user } = useCurrentUser();
  const { open } = useAuthDialog();

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [citedIds, setCitedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || abortControllerRef.current) return;

    if (!user) {
      open();
      return;
    }

    setLoading(true);
    setError(null);
    setAnswer(null);
    setCitedIds([]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const reply = await api.post<{
        answer: string;
        citedDocumentIds: string[];
        unanswered: boolean;
      }>(`/aurora/ip-commerce/ips/${ipId}/knowledge/ask`, {
        data: {
          question: question.trim(),
          locale,
        },
        signal: controller.signal,
        timeout: 45_000,
      });

      if (!controller.signal.aborted && abortControllerRef.current === controller) {
        setAnswer(reply.answer);
        setCitedIds(reply.citedDocumentIds || []);
      }
    } catch (cause) {
      if (!controller.signal.aborted && abortControllerRef.current === controller) {
        setError(cause instanceof Error && cause.message ? cause.message : t("error"));
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
        abortControllerRef.current = null;
      }
    }
  };

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <IconSparkles className="w-5 h-5 text-primary" />
        <h3 className="text-base font-semibold text-white">{t("title")}</h3>
      </div>
      <p className="text-xs text-white/60 mb-4">{t("subtitle")}</p>

      <form onSubmit={handleAsk} className="flex flex-col gap-2">
        <div className="relative flex items-center">
          <input
            type="text"
            aria-label={t("placeholder")}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("placeholder")}
            disabled={loading}
            maxLength={1000}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 pr-20 text-sm text-white placeholder-white/30 focus:border-primary/50 focus:outline-none"
          />
          {loading ? (
            <button
              type="button"
              onClick={handleCancel}
              className="absolute right-2 flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20 transition"
            >
              <IconX className="w-3.5 h-3.5" />
              {t("cancel")}
            </button>
          ) : (
            <button
              type="submit"
              disabled={!question.trim()}
              className="absolute right-2 flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-medium text-black hover:bg-primary/90 transition disabled:opacity-40"
            >
              <IconSend className="w-3.5 h-3.5" />
              {t("ask")}
            </button>
          )}
        </div>
      </form>

      {loading && (
        <div className="mt-3 flex items-center gap-2 text-xs text-white/60 animate-pulse">
          <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
          <span>{t("loading")}</span>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-red-400">
          <IconAlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {answer && (
        <div className="mt-4 rounded-lg bg-white/[0.04] p-3 text-sm text-white/90">
          <p className="whitespace-pre-wrap">{answer}</p>
          {citedIds.length > 0 && (
            <div className="mt-3 pt-2 border-t border-white/10 flex flex-wrap items-center gap-2 text-xs text-white/50">
              <span className="flex items-center gap-1 text-white/60">
                <IconFileText className="w-3.5 h-3.5" />
                {t("sources")}:
              </span>
              {citedIds.map((id, idx) => (
                <span
                  key={id}
                  className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/70"
                >
                  Ref #{idx + 1}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
