"use client";
import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useTranslations } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";
type Feedback = { likes: number; dislikes: number; mine: number | null };
export function EpisodeFeedback({ ipId, episodeId }: { ipId: string; episodeId: string }) {
  const { user } = useCurrentUser();
  return (
    <FeedbackPanel
      key={`${ipId}:${episodeId}:${user?.id ?? "guest"}`}
      ipId={ipId}
      episodeId={episodeId}
      signedIn={!!user}
    />
  );
}
function FeedbackPanel({
  ipId,
  episodeId,
  signedIn,
}: {
  ipId: string;
  episodeId: string;
  signedIn: boolean;
}) {
  const t = useTranslations("episodeFeedback");
  const { open } = useAuthDialog();
  const [data, setData] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const [retry, setRetry] = useState(0);
  const url = `/aurora/ip-commerce/ips/${ipId}/episodes/${episodeId}/feedback`;
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    api
      .get<Feedback>(url, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError(null);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active.current === controller) active.current = null;
      });
    return () => {
      controller.abort();
      active.current?.abort();
      active.current = null;
    };
  }, [url, retry]);
  async function vote(value: 1 | -1) {
    if (!signedIn) {
      open();
      return;
    }
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    try {
      const next = await api.put<Feedback>(url, {
        data: { value: data?.mine === value ? null : value },
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setData(next);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }
  return (
    <section className="my-4 space-y-2" aria-label={t("title")}>
      <p className="text-sm text-muted-foreground">{t("title")}</p>
      {!data && !error && <p role="status">{t("loading")}</p>}
      <div className="flex gap-3">
        {([1, -1] as const).map((value) => (
          <button
            type="button"
            key={value}
            disabled={pending || !data}
            aria-pressed={data?.mine === value}
            onClick={() => void vote(value)}
            className="min-h-11 rounded-lg bg-muted px-4 text-sm aria-pressed:bg-primary aria-pressed:text-white disabled:opacity-50"
          >
            {t(value === 1 ? "like" : "dislike")}{" "}
            {data ? (value === 1 ? data.likes : data.dislikes) : ""}
          </button>
        ))}
      </div>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => setRetry((n) => n + 1)}
            className="min-h-11 underline"
          >
            {t("retry")}
          </button>
        </div>
      )}
    </section>
  );
}
