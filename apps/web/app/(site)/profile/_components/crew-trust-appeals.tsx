"use client";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { useTranslations } from "@/src/i18n/i18n";
type Appeal = {
  id: string;
  reason: string;
  status: "pending" | "upheld" | "corrected";
  reviewReason: string | null;
  reviewedAt: string | null;
};
export function CrewTrustAppeals({ taskId, userId }: { taskId: string; userId: string }) {
  const t = useTranslations("trustAppeals");
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" className="min-h-11 underline" onClick={() => setOpen((v) => !v)}>
        {t("open")}
      </button>
      {open && <Form key={`${userId}:${taskId}`} taskId={taskId} userId={userId} />}
    </div>
  );
}
function Form({ taskId, userId }: { taskId: string; userId: string }) {
  const t = useTranslations("trustAppeals");
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const request = useRef<{ id: string; reason: string } | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const key = ["trust-appeals", userId, taskId];
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api.get<{ items: Appeal[]; nextCursor: string | null }>(
        `/aurora/me/crew-trust/${taskId}/appeals`,
        { signal, params: { cursor: pageParam } }
      ),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  async function submit() {
    if (active.current || !reason.trim()) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    if (request.current?.reason !== reason.trim())
      request.current = { id: crypto.randomUUID(), reason: reason.trim() };
    try {
      await api.post(`/aurora/me/crew-trust/${taskId}/appeals`, {
        data: request.current,
        signal: controller.signal,
        raw: true,
      });
      if (controller.signal.aborted) return;
      setReason("");
      request.current = null;
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  return (
    <section className="space-y-2 rounded border border-white/10 p-3">
      <p>{t("help")}</p>
      {query.isPending && <p role="status">{t("loading")}</p>}
      {(query.isError || error) && (
        <div role="alert">
          {error ?? query.error?.message}
          {query.isError && (
            <button
              type="button"
              className="min-h-11 underline"
              disabled={query.isFetching}
              onClick={() =>
                void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
              }
            >
              {t("retry")}
            </button>
          )}
        </div>
      )}
      {items.map((a) => (
        <article key={a.id} className="border-b border-white/10 py-2">
          <p>{a.reason}</p>
          <p>{t(a.status)}</p>
          {a.reviewReason && (
            <p>
              {t("reviewReason")}: {a.reviewReason}
            </p>
          )}
        </article>
      ))}
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
        >
          {t("more")}
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-2"
      >
        <textarea
          aria-label={t("reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={2000}
          disabled={busy}
          className="w-full rounded bg-white/10 p-2"
        />
        <button
          type="submit"
          className="min-h-11 underline"
          disabled={
            busy ||
            !reason.trim() ||
            query.isPending ||
            query.isError ||
            items.some((a) => a.status === "pending")
          }
        >
          {busy ? t("sending") : t("submit")}
        </button>
      </form>
    </section>
  );
}
