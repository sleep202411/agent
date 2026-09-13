"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { api } from "@/src/lib/api";
type Suggestion = { id: string; title: string; reason: string };
export function ViewerAssistance() {
  const { user } = useCurrentUser();
  const locale = useLocale();
  return (
    <Panel key={`${user?.id ?? "guest"}:${locale}`} signedIn={Boolean(user)} locale={locale} />
  );
}
function Panel({ signedIn, locale }: { signedIn: boolean; locale: string }) {
  const t = useTranslations("viewerAssistance");
  const { open } = useAuthDialog();
  const [preference, setPreference] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  function cancel() {
    active.current?.abort();
    active.current = null;
    setBusy(false);
  }
  async function ask() {
    if (active.current || !preference.trim()) return;
    if (!signedIn) {
      open();
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    const timeout = setTimeout(() => {
      if (active.current === controller) {
        controller.abort();
        active.current = null;
        setBusy(false);
        setError(t("timeout"));
      }
    }, 45000);
    try {
      const reply = await api.post<{ suggestions: Suggestion[] }>("/aurora/viewer-assistance", {
        data: { preference, locale },
        signal: controller.signal,
        timeout: 42_000,
        raw: true,
      });
      if (!controller.signal.aborted) setSuggestions(reply.suggestions);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <section aria-label={t("title")} className="space-y-3 p-4 text-sm text-white">
      <h2 className="font-semibold">{t("title")}</h2>
      <p className="text-white/60">{t("help")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          aria-label={t("preference")}
          maxLength={1000}
          value={preference}
          disabled={busy}
          onChange={(e) => setPreference(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded bg-white/10 px-3"
        />
        <button
          type="submit"
          disabled={busy || !preference.trim()}
          className="min-h-11 rounded bg-white/10 px-3 disabled:opacity-50"
        >
          {busy ? t("pending") : t("ask")}
        </button>
        {busy && (
          <button type="button" onClick={cancel} className="min-h-11 px-3">
            {t("cancel")}
          </button>
        )}
      </form>
      {error && <p role="alert">{error}</p>}
      {suggestions?.length === 0 && <p role="status">{t("empty")}</p>}
      {suggestions?.map((row) => (
        <article key={row.id} className="space-y-1">
          <Link className="underline" href={`/${locale}/ips/${encodeURIComponent(row.id)}`}>
            {row.title}
          </Link>
          <p className="text-white/60">{row.reason}</p>
        </article>
      ))}
    </section>
  );
}
