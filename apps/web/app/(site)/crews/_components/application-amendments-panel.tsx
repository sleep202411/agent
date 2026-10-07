"use client";
import {
  CURRENT_TASK_PAYMENT_TERMS,
  TASK_PAYMENT_TERMS,
  type TaskPaymentTerms,
} from "@repo/shared/crew";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { crewApi, CrewApiError } from "../_hooks/api";
import { useCrewMembership } from "../_hooks/use-members";
import { useCrewTask } from "../_hooks/use-tasks";
import {
  useApplicationTerms,
  exactMinorUnits,
  exactMajorUnits,
  type ApplicationTerms,
} from "../_hooks/use-application-terms";
import {
  useApplicationAmendments,
  type ApplicationAmendment,
  type AmendmentProposal,
} from "../_hooks/use-application-amendments";
import { crewAccountQueries } from "../_hooks/shared";

type Props = {
  applicationId: string;
  applicantId: string;
  crewId: string;
  taskId: string | null;
  status: string;
  reviewer?: boolean;
};
type Draft = {
  base: ApplicationTerms;
  paymentTerms: TaskPaymentTerms | null;
  taskVersion: number;
  scope: string;
  fee: string;
  share: string;
  basis: string;
  reason: string;
};
type Request = { path: string; body: Record<string, unknown> };
export function ApplicationAmendmentsPanel(props: Props) {
  const { user, isLoading } = useCurrentUser();
  if (!user || isLoading || props.status !== "approved" || !props.taskId) return null;
  return (
    <AmendmentsSession
      key={JSON.stringify([user.id, props.applicationId, props.taskId])}
      {...props}
      userId={user.id}
    />
  );
}
function AmendmentsSession({
  applicationId,
  applicantId,
  crewId,
  taskId,
  reviewer,
  userId,
}: Props & { userId: string }) {
  const paymentT = useTranslations("taskPaymentTerms");
  const t = useTranslations("crewAmendments"),
    client = useQueryClient();
  const history = useApplicationAmendments(applicationId, userId);
  const terms = useApplicationTerms(applicationId);
  const membership = useCrewMembership(reviewer && userId !== applicantId ? crewId : undefined);
  const canReview = Boolean(
    reviewer &&
    userId !== applicantId &&
    membership.isSuccess &&
    !membership.isError &&
    membership.data?.permissions.includes("applications.review")
  );
  const canManage = canReview && Boolean(membership.data?.permissions.includes("tasks.manage"));
  const task = useCrewTask(taskId ?? "", canManage);
  const [draft, setDraft] = useState<Draft | null>(null),
    [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [retry, setRetry] = useState<Request | null>(null);
  const [saved, setSaved] = useState<ApplicationAmendment | null>(null);
  const [savedHistory, setSavedHistory] = useState<typeof history.data>(undefined);
  const alive = useRef(true),
    pending = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const readable = history.isSuccess && !history.isError;
  const effective =
    terms.isSuccess && !terms.isError
      ? terms.data.items.find(
          (item) => item.version === terms.data.currentVersion && item.confirmedAt
        )
      : undefined;
  const rows = readable
    ? history.data.pages
        .flatMap((p) => p.items)
        .filter(
          (row) =>
            row.applicationId === applicationId &&
            row.applicantId === applicantId &&
            row.taskId === taskId
        )
    : [];
  const open = rows.some((row) => ["pending", "awaiting_settlement"].includes(row.status));
  const synchronized =
    !saved ||
    history.data !== savedHistory ||
    rows.some((row) => row.id === saved.id && row.status === saved.status);
  const validTask =
    task.isSuccess && !task.isError && task.data.id === taskId && task.data.crewId === crewId;
  const canPropose =
    canManage &&
    readable &&
    validTask &&
    effective?.feePeriod === "project" &&
    !open &&
    synchronized;
  const disabled = busy || Boolean(retry);
  const stale = Boolean(
    draft &&
    (!effective ||
      !validTask ||
      effective.version !== draft.base.version ||
      task.data?.version !== draft.taskVersion)
  );
  const fee = draft ? exactMinorUnits(draft.fee) : null,
    share = draft ? exactMinorUnits(draft.share) : null;
  const valid =
    draft &&
    fee !== null &&
    BigInt(fee) <= 10_000_000_000n &&
    share !== null &&
    BigInt(share) <= 5000n &&
    draft.scope.trim().length >= 1 &&
    draft.scope.trim().length <= 10000 &&
    draft.reason.trim().length >= 3 &&
    draft.reason.trim().length <= 4000 &&
    (BigInt(share) === 0n || (draft.basis.trim().length >= 1 && draft.basis.trim().length <= 5000));
  async function refresh() {
    await Promise.allSettled([
      history.refetch(),
      terms.refetch(),
      ...(canManage ? [task.refetch()] : []),
      ...(reviewer && userId !== applicantId ? [membership.refetch()] : []),
    ]);
  }
  async function write(request: Request, recovery = false) {
    if (!alive.current || pending.current || !readable || (retry && !recovery)) return;
    pending.current = true;
    setBusy(true);
    setError("");
    let result: ApplicationAmendment;
    try {
      result = await crewApi.post<ApplicationAmendment>(request.path, { body: request.body });
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : t("failed"));
        setRetry(
          err instanceof CrewApiError && [400, 401, 403, 404, 409, 422].includes(err.status)
            ? null
            : request
        );
        setBusy(false);
      }
      pending.current = false;
      return;
    }
    if (!alive.current) {
      pending.current = false;
      return;
    }
    setSavedHistory(history.data);
    setSaved(result);
    setRetry(null);
    setDraft(null);
    setExpanded(false);
    await Promise.allSettled([
      client.invalidateQueries({
        queryKey: ["crew-application-amendments", applicationId, userId],
      }),
      client.invalidateQueries({ queryKey: ["crew-application-terms", applicationId, userId] }),
      client.invalidateQueries(crewAccountQueries(["crew"], userId)),
      client.invalidateQueries({ queryKey: ["my-crew-applications", userId] }),
    ]);
    pending.current = false;
    if (alive.current) setBusy(false);
  }
  function decide(id: string, action: "confirm" | "reject" | "withdraw") {
    void write({
      path: `/applications/${encodeURIComponent(applicationId)}/amendments/${encodeURIComponent(id)}/decision`,
      body: { action },
    });
  }
  function begin() {
    if (disabled || !canPropose || !effective || !task.data) return;
    setDraft({
      base: { ...effective },
      taskVersion: task.data.version,
      scope: effective.scope,
      fee: exactMajorUnits(effective.feeAmount),
      paymentTerms: effective.paymentTerms ?? null,
      share: exactMajorUnits(String(effective.revenueShareBp)),
      basis: effective.shareBasis ?? "",
      reason: "",
    });
    setSaved(null);
    setExpanded(true);
  }
  return (
    <section className="space-y-3 px-4 py-3" aria-label={t("title")}>
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted-foreground">{t("boundary")}</p>
      <Button
        variant="outline"
        disabled={busy || history.isFetching || terms.isFetching}
        onClick={() => void refresh()}
      >
        {t("refresh")}
      </Button>
      {history.isPending && <p>{t("loading")}</p>}
      {history.isError && <p role="alert">{history.error.message}</p>}
      {terms.isError && <p role="alert">{terms.error.message}</p>}
      {reviewer && membership.isError && <p role="alert">{membership.error.message}</p>}
      {canManage && task.isError && <p role="alert">{task.error.message}</p>}
      {error && <p role="alert">{error}</p>}
      {readable && (
        <>
          {effective ? (
            <div>
              <h4 className="font-medium">{t("effective", { version: effective.version })}</h4>
              <TermsView terms={effective} />
            </div>
          ) : (
            <p>{t("noEffective")}</p>
          )}
          {saved && (
            <p role="status">
              {t("saved")}: {t(`status.${saved.status}`)}
            </p>
          )}
          {retry && (
            <div>
              <p>{t("retryHelp")}</p>
              <Button disabled={busy} onClick={() => void write(retry, true)}>
                {t("retry")}
              </Button>
            </div>
          )}
          {canPropose && !draft && (
            <Button disabled={disabled} onClick={begin}>
              {t("propose")}
            </Button>
          )}
          {draft && (
            <>
              <Button variant="outline" onClick={() => setExpanded((v) => !v)}>
                {t(expanded ? "collapse" : "expand")}
              </Button>
              {expanded && (
                <fieldset disabled={disabled || !canManage} className="space-y-3">
                  <p>{t("basedOn", { terms: draft.base.version, task: draft.taskVersion })}</p>
                  <p>
                    {draft.base.currency} · {t("projectFee")}
                  </p>
                  {stale && <p role="alert">{t("stale")}</p>}
                  <label className="block">
                    {t("scope")}
                    <Textarea
                      maxLength={10000}
                      value={draft.scope}
                      onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    {t("fee")}
                    <Input
                      inputMode="decimal"
                      value={draft.fee}
                      onChange={(e) => setDraft({ ...draft, fee: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    {paymentT("label")}
                    <NativeSelect
                      aria-label={paymentT("label")}
                      value={draft.paymentTerms ?? "unspecified"}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          paymentTerms: TASK_PAYMENT_TERMS.find((term) => term === value) ?? null,
                        })
                      }
                    >
                      <NativeSelectOption value="unspecified">
                        {paymentT("unspecified")}
                      </NativeSelectOption>
                      {draft.paymentTerms === "monthly" && (
                        <NativeSelectOption value="monthly">
                          {paymentT("monthly")}
                        </NativeSelectOption>
                      )}
                      {CURRENT_TASK_PAYMENT_TERMS.map((value) => (
                        <NativeSelectOption key={value} value={value}>
                          {paymentT(value)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <label className="block">
                    {t("share")}
                    <Input
                      inputMode="decimal"
                      value={draft.share}
                      onChange={(e) => setDraft({ ...draft, share: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    {t("basis")}
                    <Textarea
                      maxLength={5000}
                      value={draft.basis}
                      onChange={(e) => setDraft({ ...draft, basis: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    {t("reason")}
                    <Textarea
                      maxLength={4000}
                      value={draft.reason}
                      onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                    />
                  </label>
                  <Button
                    disabled={disabled || !canPropose || stale || !valid}
                    onClick={() => {
                      if (!disabled && canPropose && !stale && valid)
                        void write({
                          path: `/applications/${encodeURIComponent(applicationId)}/amendments`,
                          body: {
                            id: crypto.randomUUID(),
                            expectedVersion: draft.base.version,
                            expectedTaskVersion: draft.taskVersion,
                            scope: draft.scope.trim(),
                            currency: draft.base.currency,
                            feePeriod: "project",
                            paymentTerms: draft.paymentTerms,
                            feeAmount: fee!,
                            revenueShareBp: Number(share),
                            shareBasis: BigInt(share!) > 0n ? draft.basis.trim() : null,
                            reason: draft.reason.trim(),
                          },
                        });
                    }}
                  >
                    {t("sendProposal")}
                  </Button>
                  <Button variant="outline" disabled={disabled || !canPropose} onClick={begin}>
                    {t("discard")}
                  </Button>
                </fieldset>
              )}
            </>
          )}
          <h4 className="font-medium">{t("history")}</h4>
          <p className="text-sm text-muted-foreground">{t("historyHelp")}</p>
          {!rows.length && <p>{t("empty")}</p>}
          {rows.map((row) => (
            <AmendmentHistoryItem
              key={row.id}
              row={saved?.id === row.id && history.data === savedHistory ? saved : row}
              userId={userId}
              applicantId={applicantId}
              canReview={canReview}
              disabled={disabled}
              onDecision={decide}
            />
          ))}

          {history.hasNextPage && (
            <Button
              disabled={busy || history.isFetching}
              onClick={() => void history.fetchNextPage()}
            >
              {t("more")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
function TermsView({ terms }: { terms: ApplicationTerms | AmendmentProposal }) {
  const paymentT = useTranslations("taskPaymentTerms");
  const t = useTranslations("crewAmendments"),
    unitT = useTranslations("crewTerms");
  return (
    <div className="space-y-1 text-sm">
      <p className="whitespace-pre-wrap">{terms.scope}</p>
      {terms.paymentTerms && (
        <p>
          {paymentT("label")}: {paymentT(terms.paymentTerms)}
        </p>
      )}
      <p>
        {terms.currency} {exactMajorUnits(terms.feeAmount)} · {unitT(terms.feePeriod)}
      </p>
      <p>
        {t("share")}: {exactMajorUnits(String(terms.revenueShareBp))}%
      </p>
      {terms.shareBasis && <p className="whitespace-pre-wrap">{terms.shareBasis}</p>}
    </div>
  );
}

function AmendmentHistoryItem({
  row,
  userId,
  applicantId,
  canReview,
  disabled,
  onDecision,
}: {
  row: ApplicationAmendment;
  userId: string;
  applicantId: string;
  canReview: boolean;
  disabled: boolean;
  onDecision: (id: string, action: "confirm" | "reject" | "withdraw") => void;
}) {
  const t = useTranslations("crewAmendments");
  const actionable = ["pending", "awaiting_settlement"].includes(row.status);
  return (
    <article className="space-y-2 border-t border-border pt-3">
      <p>{t(`status.${row.status}`)}</p>
      <p>{t("proposer", { id: row.proposedByUserId })}</p>
      <p>
        {t("basedOn", {
          terms: row.proposal.expectedVersion,
          task: row.proposal.expectedTaskVersion,
        })}
      </p>
      <TermsView terms={row.proposal} />
      <p className="whitespace-pre-wrap">
        {t("reason")}: {row.proposal.reason}
      </p>
      {actionable && (
        <div className="flex flex-wrap gap-2">
          {userId === applicantId && (
            <>
              {row.status === "pending" && (
                <Button disabled={disabled} onClick={() => onDecision(row.id, "confirm")}>
                  {t("confirm")}
                </Button>
              )}
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => onDecision(row.id, "reject")}
              >
                {t("reject")}
              </Button>
            </>
          )}
          {canReview && userId === row.proposedByUserId && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => onDecision(row.id, "withdraw")}
            >
              {t("withdraw")}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
