"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { crewApi, CrewApiError } from "../_hooks/api";
import { crewAccountQueries } from "../_hooks/shared";
import { useCrewMembership } from "../_hooks/use-members";
import { exactMajorUnits } from "../_hooks/use-application-terms";
import type { ApplicationAmendment } from "../_hooks/use-application-amendments";
import {
  amendmentFinanceKey,
  useAmendmentFinanceQueue,
  type AmendmentQueueStatus,
} from "../_hooks/use-amendment-finance-queue";

export function AmendmentFinancePanel({ crewId }: { crewId: string }) {
  const { user, isLoading } = useCurrentUser();
  if (!user || isLoading) return null;
  return (
    <FinanceSession key={JSON.stringify([crewId, user.id])} crewId={crewId} userId={user.id} />
  );
}

function FinanceSession({ crewId, userId }: { crewId: string; userId: string }) {
  const t = useTranslations("crewAmendmentFinance");
  const statusT = useTranslations("crewAmendments.status");
  const client = useQueryClient();
  const membership = useCrewMembership(crewId);
  const [writeDenied, setWriteDenied] = useState(false);
  const authorized =
    !writeDenied &&
    membership.isSuccess &&
    !membership.isError &&
    Boolean(membership.data?.permissions.includes("finance.earnings.approve"));
  const [filter, setFilter] = useState<AmendmentQueueStatus>("awaiting_settlement");
  const queue = useAmendmentFinanceQueue(crewId, filter, userId, authorized);
  const readable = authorized && queue.isSuccess && !queue.isError;
  const [selected, setSelected] = useState<ApplicationAmendment | null>(null);
  const [retry, setRetry] = useState<ApplicationAmendment | null>(null);
  const [completed, setCompleted] = useState<ApplicationAmendment[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const pending = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const rows = readable
    ? queue.data.pages
        .flatMap((page) => page.items)
        .filter(
          (row, i, all) =>
            row.status === filter &&
            all.findIndex((other) => other.id === row.id) === i &&
            !(filter === "awaiting_settlement" && completed.some((done) => done.id === row.id))
        )
    : [];
  const current = selected && rows.find((row) => row.id === selected.id);
  const unchanged = Boolean(
    current && selected && JSON.stringify(current) === JSON.stringify(selected)
  );
  const disabled = busy || queue.isFetching || membership.isFetching;

  async function refresh() {
    if (pending.current) return;
    setWriteDenied(false);
    // Restart from the first page, including recovery from an invalid cursor.
    await Promise.allSettled([
      membership.refetch(),
      client.resetQueries({ queryKey: amendmentFinanceKey(crewId, filter, userId), exact: true }),
    ]);
  }

  async function apply(row: ApplicationAmendment, recovering = false) {
    if (!alive.current || pending.current || !readable || disabled) return;
    if (recovering ? retry?.id !== row.id : !readable || !unchanged || disabled || Boolean(retry))
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    let result: ApplicationAmendment;
    try {
      result = await crewApi.post<ApplicationAmendment>(
        `/applications/${encodeURIComponent(row.applicationId)}/amendments/${encodeURIComponent(row.id)}/settle`
      );
      if (
        result.id !== row.id ||
        result.applicationId !== row.applicationId ||
        !["effective", "settlement_requested"].includes(result.status) ||
        !result.settledAt
      ) {
        throw new Error(t("unknownResult"));
      }
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : t("failed"));
        const definitive =
          err instanceof CrewApiError && [400, 401, 403, 404, 409, 422].includes(err.status);
        setRetry(definitive ? null : row);
        // A new review is required after a definitive rejection; never silently resubmit.
        if (definitive) setSelected(null);
        if (err instanceof CrewApiError && [401, 403].includes(err.status)) setWriteDenied(true);
        setBusy(false);
      }
      pending.current = false;
      return;
    }
    if (!alive.current) {
      pending.current = false;
      return;
    }
    setCompleted((previous) => [result, ...previous.filter((item) => item.id !== result.id)]);
    setSelected(null);
    setRetry(null);
    await Promise.allSettled([
      client.invalidateQueries(crewAccountQueries(["crew-amendment-finance", crewId], userId)),
      client.invalidateQueries(crewAccountQueries(["crew"], userId)),
      client.invalidateQueries({
        queryKey: ["crew-application-amendments", row.applicationId, userId],
      }),
      client.invalidateQueries({ queryKey: ["crew-application-terms", row.applicationId, userId] }),
      client.invalidateQueries({ queryKey: ["my-crew-applications", userId] }),
      client.invalidateQueries({ queryKey: ["crew-personal-earnings", userId] }),
      client.invalidateQueries({ queryKey: ["crew-personal-payouts", userId] }),
    ]);
    pending.current = false;
    if (alive.current) setBusy(false);
  }

  if (!authorized)
    return membership.isPending ? null : (
      <section className="space-y-2 py-4" aria-label={t("title")}>
        <p role="alert">{error || membership.error?.message || t("denied")}</p>
        <Button variant="outline" disabled={membership.isFetching} onClick={() => void refresh()}>
          {t("refresh")}
        </Button>
      </section>
    );

  return (
    <section className="space-y-3 border-b border-white/[0.07] py-5" aria-label={t("title")}>
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <div className="flex flex-wrap gap-2">
        {(["awaiting_settlement", "settlement_requested"] as const).map((status) => (
          <Button
            key={status}
            variant="outline"
            aria-pressed={filter === status}
            disabled={busy || Boolean(retry)}
            onClick={() => {
              setFilter(status);
              setSelected(null);
              setError("");
            }}
          >
            {statusT(status)}
          </Button>
        ))}
        <Button variant="outline" disabled={disabled} onClick={() => void refresh()}>
          {t("refresh")}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {completed.length > 0 && (
        <div role="status" className="space-y-2 text-sm">
          {completed.map((row) => (
            <p key={row.id}>
              {t("recorded", { id: row.id })} {statusT(row.status)}.{" "}
              {t(row.status === "effective" ? "effectiveResult" : "manualResult")}
            </p>
          ))}
        </div>
      )}
      {retry && (
        <div className="space-y-2">
          <p className="text-sm">{t("retryHelp", { id: retry.id })}</p>
          <Button disabled={disabled || !readable} onClick={() => void apply(retry, true)}>
            {t("retry")}
          </Button>
        </div>
      )}
      {queue.isPending && <p role="status">{t("loading")}</p>}
      {queue.isError && <p role="alert">{queue.error.message || t("failed")}</p>}
      {readable && (
        <>
          {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
          {selected && !retry && !unchanged && <p role="alert">{t("stale")}</p>}
          {rows.map((row) => (
            <article key={row.id} className="space-y-2 rounded-lg bg-muted/30 p-4">
              <AmendmentDetails row={row} />
              {row.status === "settlement_requested" ? (
                <p className="text-sm">{t("manualResult")}</p>
              ) : (
                row.confirmedAt &&
                !row.settledAt && (
                  <>
                    {selected?.id === row.id ? (
                      <div className="space-y-3">
                        <p className="text-sm">{t("confirmation")}</p>
                        <p className="text-sm text-muted-foreground">{t("permissions")}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={disabled || Boolean(retry) || !unchanged}
                            onClick={() => void apply(selected)}
                          >
                            {t("apply")}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy || Boolean(retry)}
                            onClick={() => setSelected(null)}
                          >
                            {t("cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={disabled || Boolean(retry)}
                        onClick={() => {
                          setSelected(row);
                          setError("");
                        }}
                      >
                        {t("review")}
                      </Button>
                    )}
                  </>
                )
              )}
            </article>
          ))}
          {queue.hasNextPage && (
            <Button
              variant="outline"
              disabled={disabled || Boolean(retry)}
              onClick={() => void queue.fetchNextPage()}
            >
              {t("more")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function AmendmentDetails({ row }: { row: ApplicationAmendment }) {
  const t = useTranslations("crewAmendmentFinance");
  const terms = useTranslations("crewAmendments");
  const paymentT = useTranslations("taskPaymentTerms");
  const p = row.proposal;
  return (
    <div className="space-y-1 break-words text-sm">
      <p>
        {t("identity", { amendment: row.id, application: row.applicationId, task: row.taskId })}
      </p>
      <p>{t("people", { creator: row.applicantId, proposer: row.proposedByUserId })}</p>
      <p>
        {t("target")}: {p.currency} {exactMajorUnits(p.feeAmount)}
      </p>
      {p.paymentTerms && (
        <p>
          {paymentT("label")}: {paymentT(p.paymentTerms)}
        </p>
      )}
      <p className="whitespace-pre-wrap">
        {terms("scope")}: {p.scope}
      </p>
      <p>
        {terms("share")}: {exactMajorUnits(String(p.revenueShareBp))}%
      </p>
      {p.shareBasis && (
        <p className="whitespace-pre-wrap">
          {terms("basis")}: {p.shareBasis}
        </p>
      )}
      <p className="whitespace-pre-wrap">
        {terms("reason")}: {p.reason}
      </p>
      <p>{t("consent", { date: row.confirmedAt ?? "—" })}</p>
    </div>
  );
}
