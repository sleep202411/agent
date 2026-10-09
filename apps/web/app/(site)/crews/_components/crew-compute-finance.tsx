"use client";
import { CrewComputeTopUpForm } from "./crew-compute-top-up-form";
import { COMPUTE_POINTS_PER_USD_CENT } from "@repo/shared";
import { useMemo, useState } from "react";
import { computeRequestsPageSchema } from "../_hooks/compute-requests-data";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useComputeRequests } from "../_hooks/use-compute-requests";
import { displayNameOf, useUserDisplays } from "../_hooks/use-users";

export function CrewComputeFinance({
  crewId,
  crewName,
  initialTaskId,
}: {
  initialTaskId?: string;
  crewId: string;
  crewName: string;
}) {
  const t = useTranslations("crewComputeFinance");
  const locale = useLocale();
  const [cursor, setCursor] = useState<string>();
  const query = useComputeRequests(crewId, cursor);
  const parsed = useMemo(() => computeRequestsPageSchema.safeParse(query.data), [query.data]);
  const data = parsed.success ? parsed.data : undefined;
  const displays = useUserDisplays([
    ...(data?.tasks.flatMap((task) => task.assignees?.map((a) => a.userId) ?? []) ?? []),
    ...(data?.taskUsage?.map((row) => row.userId) ?? []),
    ...(data?.items.flatMap((row) => [
      row.userId,
      ...(row.requestedByUserId ? [row.requestedByUserId] : []),
      ...(row.decidedByUserId ? [row.decidedByUserId] : []),
    ]) ?? []),
  ]);
  const consumed = BigInt(data?.consumedPoints ?? "0");
  const cents = consumed / BigInt(COMPUTE_POINTS_PER_USD_CENT);
  const usd = `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  return (
    <section
      className="min-w-0 space-y-6 rounded-2xl bg-[#121214] p-4 sm:p-6"
      aria-label={t("title")}
    >
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">
          {crewName} · {t("description")}
        </p>
      </div>
      {query.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : query.isError || !data ? (
        <div role="alert">
          {query.isError ? query.error.message : t("loadFailed")}
          <Button variant="ghost" onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {data.isOwner ? t("crewScope") : t("myScope")}
          </p>
          {data.projectBudget && (
            <div className="space-y-1 rounded-xl bg-white/[0.04] p-4 text-sm">
              <p>
                {t("projectBudgetSummary", {
                  total: data.projectBudget.totalPoints,
                  rate: (data.projectBudget.pointsPerMinute ?? 4462).toLocaleString(locale),
                  released: data.projectBudget.releasedPoints,
                })}
              </p>
              {data.projectBudget.closed && <p>{t("projectBudgetClosed")}</p>}
              {data.projectBudget.producerSettlement && (
                <p>
                  {t("producerDeduction", {
                    amount: data.projectBudget.producerSettlement.deductionMinor,
                    currency: data.projectBudget.producerSettlement.currency,
                  })}{" "}
                  · {data.projectBudget.producerSettlement.note}
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 [&>div]:min-w-0 [&>div]:rounded-xl [&>div]:bg-white/[0.04] [&>div]:p-4 [&_strong]:text-xl [&_strong]:tabular-nums">
            <div>
              <p className="text-sm text-muted-foreground">{t("pending")}</p>
              <strong>{(data.totals.pending ?? 0).toLocaleString(locale)}</strong>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("approvedTotal")}</p>
              <strong>{(data.totals.approved ?? 0).toLocaleString(locale)}</strong>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("consumed")}</p>
              <strong>
                {consumed.toLocaleString(locale)} {t("points")} (USD {usd})
              </strong>
              <p className="text-xs text-muted-foreground">{t("equivalent")}</p>
            </div>
          </div>
          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] [&>div]:min-w-0 [&>form]:min-w-0">
            {data.taskUsage && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <caption className="text-left">{t("usageByTask")}</caption>
                  <thead>
                    <tr>
                      {["task", "creator", "approvedTotal", "pending", "consumed", "committed"].map(
                        (k) => (
                          <th key={k} className="p-2">
                            {t(k)}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.taskUsage
                      .filter((row) => !initialTaskId || row.taskId === initialTaskId)
                      .map((row) => (
                        <tr key={`${row.taskId}:${row.userId}`}>
                          <td className="p-2">{row.taskTitle}</td>
                          <td className="p-2">{displayNameOf(row.userId, displays)}</td>
                          {[
                            row.approvedPoints,
                            row.pendingPoints,
                            row.consumedPoints,
                            row.committedPoints,
                          ].map((v, i) => (
                            <td key={i} className="p-2">
                              {BigInt(v).toLocaleString(locale)}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <CrewComputeTopUpForm
              crewId={crewId}
              crewName={crewName}
              initialTaskId={initialTaskId}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.07]">
                  {["task", "applicant", "creator", "points", "reason", "status", "decision"].map(
                    (key) => (
                      <th className="p-2 font-medium" key={key}>
                        {t(key)}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id} className="border-b border-white/[0.07]">
                    <td className="p-2">
                      {row.taskTitle}
                      <p className="text-xs text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString(locale)}
                      </p>
                    </td>
                    <td className="p-2">
                      {row.requestedByUserId ? displayNameOf(row.requestedByUserId, displays) : "—"}
                    </td>
                    <td className="p-2">{displayNameOf(row.userId, displays)}</td>
                    <td className="p-2">{row.points.toLocaleString(locale)}</td>
                    <td className="max-w-xs whitespace-pre-wrap break-words p-2">{row.reason}</td>
                    <td className="p-2">{t(row.status)}</td>
                    <td className="p-2">
                      {row.decidedByAdminId
                        ? t("adminReviewer")
                        : row.decidedByUserId
                          ? displayNameOf(row.decidedByUserId, displays)
                          : null}
                      <p className="whitespace-pre-wrap">{row.decisionNote}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.items.length && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
          <div className="flex gap-2">
            {cursor && (
              <Button variant="ghost" onClick={() => setCursor(undefined)}>
                {t("latest")}
              </Button>
            )}
            {data.nextCursor && (
              <Button variant="ghost" onClick={() => setCursor(data.nextCursor!)}>
                {t("older")}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
