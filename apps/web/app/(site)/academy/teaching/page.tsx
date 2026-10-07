"use client";
import { useInfiniteQuery, useQueryClient, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { learningApi, type Enrollment } from "../../courses/_learning/api";

export default function TeacherWorkspace() {
  const { user } = useCurrentUser();
  const t = useTranslations("academyLearning");
  const locale = useLocale();
  const client = useQueryClient();
  const [selected, setSelected] = useState<(Enrollment & { viewerId: string }) | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["academy-teaching", user?.id],
    enabled: !!user,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => learningApi.teaching(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 15000,
    retry: false,
  });
  const summary = useQuery({
    queryKey: ["academy-teaching-summary", user?.id],
    enabled: !!user,
    queryFn: ({ signal }) => learningApi.summary(signal),
    refetchInterval: 15000,
    retry: false,
  });
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-5 py-8">
      <h1 className="text-2xl font-semibold">{t("teacherWorkspace")}</h1>
      <p className="text-sm text-muted-foreground">{t("creditIncomeNote")}</p>
      <Link className="underline" href={`/${locale}/crews/income`}>
        {t("income")}
      </Link>
      {user && summary.data && (
        <div className="grid gap-4 sm:grid-cols-4">
          {(["courses", "students", "pending", "earnedCredits"] as const).map((key) => (
            <div className="rounded-xl bg-white/5 p-4" key={key}>
              <p className="text-xs text-muted-foreground">{t(key)}</p>
              <p className="mt-2 text-lg font-semibold">{summary.data[key]}</p>
            </div>
          ))}
        </div>
      )}
      {summary.error && <p role="alert">{summary.error.message}</p>}
      {!user ? (
        <p>{t("signIn")}</p>
      ) : query.error ? (
        <div role="alert">
          {query.error.message}
          <Button onClick={() => void query.refetch()}>{t("retry")}</Button>
        </div>
      ) : query.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          {rows.length === 0 && <p>{t("empty")}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {["course", "student", "status", "income", "action"].map((k) => (
                    <th key={k} className="p-3">
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-white/10">
                    <td className="p-3">
                      <Link href={`/${locale}/courses/${row.courseId}`}>
                        {row.courseTitle ?? row.courseId}
                      </Link>
                    </td>
                    <td className="p-3">{row.studentName ?? row.studentId}</td>
                    <td className="p-3">{t(row.status)}</td>
                    <td className="p-3">
                      {t("credits", {
                        amount: row.status === "approved" ? row.teacherCredits : "0",
                      })}
                    </td>
                    <td className="p-3">
                      <Button onClick={() => setSelected({ ...row, viewerId: user.id })}>
                        {t("review")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.hasNextPage && (
            <Button disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
              {t("more")}
            </Button>
          )}
        </>
      )}
      {selected && user && selected.viewerId === user.id && (
        <Review
          key={`${user.id}:${selected.id}`}
          row={selected}
          close={() => setSelected(null)}
          saved={async () => {
            setSelected(null);
            await Promise.all([
              client.invalidateQueries({ queryKey: ["academy-teaching", user.id] }),
              client.invalidateQueries({ queryKey: ["academy-teaching-summary", user.id] }),
            ]);
          }}
        />
      )}
    </main>
  );
}
function Review({
  row,
  close,
  saved,
}: {
  row: Enrollment;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const t = useTranslations("academyLearning");
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  async function decide(decision: "approved" | "revision") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await learningApi.review(row.id, {
        expectedVersion: row.version,
        decision,
        score: Number(score),
        feedback,
      });
      await saved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failed"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto bg-[#171719] p-6">
        <div className="flex items-center justify-between">
          <DialogTitle>{t("review")}</DialogTitle>
          <Button disabled={busy} onClick={close}>
            {t("close")}
          </Button>
        </div>
        <p className="whitespace-pre-wrap">{row.description}</p>
        {row.assetIds.map((id, i) => (
          <Button
            key={id}
            onClick={async () => {
              try {
                const result = await learningApi.attachment(row.id, id);
                window.open(result.url, "_blank", "noopener,noreferrer");
              } catch (e) {
                setError(e instanceof Error ? e.message : t("failed"));
              }
            }}
          >
            {t("attachment", { number: i + 1 })}
          </Button>
        ))}
        {row.feedback && (
          <p>
            {row.score}/100 · {row.feedback}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {row.status === "submitted" && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void decide("approved");
            }}
          >
            <label className="grid gap-2">
              {t("score")}
              <input
                required
                type="number"
                min={0}
                max={100}
                value={score}
                disabled={busy}
                onChange={(e) => setScore(e.target.value)}
                className="rounded border border-white/15 bg-transparent p-2"
              />
            </label>
            <label className="grid gap-2">
              {t("feedback")}
              <textarea
                required
                maxLength={10000}
                value={feedback}
                disabled={busy}
                onChange={(e) => setFeedback(e.target.value)}
                className="min-h-28 rounded border border-white/15 bg-transparent p-2"
              />
            </label>
            <div className="flex gap-3">
              <Button type="submit" disabled={busy}>
                {t("approve")}
              </Button>
              <Button
                type="button"
                disabled={
                  busy ||
                  score === "" ||
                  !feedback.trim() ||
                  Number(score) < 0 ||
                  Number(score) > 100
                }
                onClick={() => void decide("revision")}
              >
                {t("return")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
