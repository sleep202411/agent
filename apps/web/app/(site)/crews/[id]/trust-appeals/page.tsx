"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";
type Appeal = {
  status: "pending" | "upheld" | "corrected";
  reviewReason: string | null;
  id: string;
  taskId: string;
  userId: string;
  reason: string;
  submissionId: string;
  points: number;
  originalPoints: number;
  currentCorrectionId: string | null;
  submittedAt: string;
  deadline: string;
};
export default function Page() {
  const { id } = useParams<{ id: string }>();
  const { user } = useCurrentUser();
  return user ? <Queue key={`${user.id}:${id}`} crewId={id} userId={user.id} /> : null;
}
function Queue({ crewId, userId }: { crewId: string; userId: string }) {
  const t = useTranslations("trustAppeals"),
    locale = useLocale(),
    qc = useQueryClient();
  const [history, setHistory] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ["crew-trust-appeals", userId, crewId, history],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api.get<{ items: Appeal[]; nextCursor: string | null }>(
        `/aurora/crews/${crewId}/trust-appeals`,
        { signal, params: { cursor: pageParam, status: history ? "all" : "pending" } }
      ),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
  });
  const [selected, setSelected] = useState<Appeal | null>(null);
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState("upheld");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function review() {
    if (!selected || active.current || !reason.trim()) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/aurora/crews/${crewId}/trust-appeals/${selected.id}/review`, {
        data: {
          decision: decision === "upheld" ? "upheld" : "corrected",
          ...(decision === "upheld" ? {} : { points: Number(decision) }),
          reason,
          expectedCorrectionId: selected.currentCorrectionId,
        },
        signal: controller.signal,
        raw: true,
      });
      if (controller.signal.aborted) return;
      setSelected(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["crew-trust-appeals", userId, crewId] });
      void qc.invalidateQueries({ queryKey: ["crew-trust"] });
      void qc.invalidateQueries({ queryKey: ["crew-trust-history"] });
      void qc.invalidateQueries({ queryKey: ["trust-appeals"] });
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
    <main className="mx-auto max-w-4xl space-y-4 p-4 text-white">
      <Link href={`/${locale}/crews/${crewId}/workspace`} className="underline">
        {t("back")}
      </Link>
      <h1 className="text-xl font-semibold">{t("queue")}</h1>
      <p>{t("managerHelp")}</p>
      <label>
        <input
          type="checkbox"
          checked={history}
          disabled={busy || Boolean(selected)}
          onChange={(e) => setHistory(e.target.checked)}
        />{" "}
        {t("history")}
      </label>
      <button
        type="button"
        className="min-h-11 underline"
        disabled={busy || query.isFetching}
        onClick={async () => {
          const refreshed = await query.refetch();
          if (refreshed.isSuccess && selected) {
            const current = refreshed.data.pages
              .flatMap((p) => p.items)
              .find((a) => a.id === selected.id);
            setSelected(current ?? null);
          }
        }}
      >
        {t("refresh")}
      </button>
      {query.isPending && <p role="status">{t("loading")}</p>}
      {query.isError && (
        <div role="alert">
          {query.error.message}
          <button
            type="button"
            disabled={query.isFetching || busy}
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </button>
        </div>
      )}
      {query.data?.pages
        .flatMap((p) => p.items)
        .map((a) => (
          <article key={a.id} className="space-y-2 rounded border border-white/10 p-3">
            <p className="break-all">
              {t("task")}: {a.taskId} · {t("creator")}: {a.userId}
            </p>
            <p>{a.reason}</p>
            <p>{t(a.status)}</p>
            {a.reviewReason && (
              <p>
                {t("reviewReason")}: {a.reviewReason}
              </p>
            )}
            <p>
              {t("original")}: {a.originalPoints} · {t("current")}: {a.points}
            </p>
            <p>
              {t("submitted")}: {a.submittedAt} · {t("deadline")}: {a.deadline}
            </p>
            <button
              type="button"
              className="min-h-11 underline"
              disabled={busy || query.isFetching || a.status !== "pending"}
              onClick={() => {
                setSelected(a);
                setReason("");
                setDecision("upheld");
                setError(null);
              }}
            >
              {t("review")}
            </button>
          </article>
        ))}
      {query.data && !query.data.pages.some((p) => p.items.length) && <p>{t("empty")}</p>}
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetching || busy}
          onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
        >
          {t("more")}
        </button>
      )}
      {selected && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void review();
          }}
          className="space-y-3 rounded border border-white/10 p-4"
        >
          <p className="break-all">{selected.taskId}</p>
          <p>{t("shared")}</p>
          <NativeSelect
            aria-label={t("decision")}
            className="w-full bg-neutral-900 p-2"
            value={decision}
            disabled={busy}
            onChange={setDecision}
          >
            <NativeSelectOption value="upheld">{t("uphold")}</NativeSelectOption>
            <NativeSelectOption value="200">{t("onTime")}</NativeSelectOption>
            <NativeSelectOption value="-200">{t("late")}</NativeSelectOption>
          </NativeSelect>
          <textarea
            aria-label={t("reviewReason")}
            className="w-full bg-white/10 p-2"
            value={reason}
            maxLength={2000}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && <p role="alert">{error}</p>}
          <button type="submit" className="min-h-11 underline" disabled={busy || !reason.trim()}>
            {busy ? t("sending") : t("confirm")}
          </button>
          <button
            type="button"
            className="min-h-11 px-3"
            disabled={busy}
            onClick={() => setSelected(null)}
          >
            {t("cancel")}
          </button>
        </form>
      )}
    </main>
  );
}
