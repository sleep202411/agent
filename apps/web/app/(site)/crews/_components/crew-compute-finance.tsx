"use client";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { COMPUTE_POINTS_PER_USD_CENT } from "@repo/shared";
import { useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { computeRequestsPageSchema } from "../_hooks/compute-requests-data";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useComputeRequests, useComputeRequestAction } from "../_hooks/use-compute-requests";
import { displayNameOf, useUserDisplays } from "../_hooks/use-users";

export function CrewComputeFinance({ crewId, crewName }: { crewId: string; crewName: string }) {
  const t = useTranslations("crewComputeFinance");
  const locale = useLocale();
  const [cursor, setCursor] = useState<string>();
  const query = useComputeRequests(crewId, cursor);
  const action = useComputeRequestAction(crewId);
  const parsed = useMemo(() => computeRequestsPageSchema.safeParse(query.data), [query.data]);
  const data = parsed.success ? parsed.data : undefined;
  const [taskId, setTaskId] = useState("");
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const requestKey = useRef<string | undefined>(undefined);
  const displays = useUserDisplays(
    data?.items.flatMap((row) => [
      row.userId,
      ...(row.decidedByUserId ? [row.decidedByUserId] : []),
    ]) ?? []
  );
  const number = Number(points);
  const canRequest =
    taskId &&
    data?.tasks.some((task) => task.id === taskId) &&
    Number.isInteger(number) &&
    number > 0 &&
    number <= 2_000_000_000 &&
    reason.trim();
  const error = (err: unknown) => toast.error(err instanceof Error ? err.message : String(err));
  const edit = () => {
    requestKey.current = undefined;
  };
  const consumed = BigInt(data?.consumedPoints ?? "0");
  const cents = consumed / BigInt(COMPUTE_POINTS_PER_USD_CENT);
  const usd = `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  return (
    <section className="mb-8 space-y-4 border-b border-white/[0.07] pb-6" aria-label={t("title")}>
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
            <div className="space-y-1 text-sm">
              <p>
                {t("projectBudgetSummary", {
                  total: data.projectBudget.totalPoints,
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
          <div className="grid gap-4 sm:grid-cols-3">
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
          {data.tasks.length ? (
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!canRequest || action.isPending) return;
                let key: string;
                try {
                  key = requestKey.current ??= uuidv4();
                } catch (cause) {
                  error(cause);
                  return;
                }
                action.mutate(
                  { taskId, points: number, reason: reason.trim(), requestKey: key },
                  {
                    onSuccess: () => {
                      setReason("");
                      setPoints("");
                      edit();
                      setCursor(undefined);
                    },
                    onError: error,
                  }
                );
              }}
            >
              <label className="space-y-1 text-sm">
                {t("task")}
                <NativeSelect
                  className="h-10 w-full rounded-md bg-muted px-3"
                  aria-label={t("task")}
                  value={taskId}
                  disabled={action.isPending}
                  onChange={(value) => {
                    setTaskId(value);
                    edit();
                  }}
                >
                  <NativeSelectOption value="">{t("selectTask")}</NativeSelectOption>
                  {data.tasks.map((task) => (
                    <NativeSelectOption key={task.id} value={task.id}>
                      TASK-{task.number} · {task.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="space-y-1 text-sm">
                {t("points")}
                <Input
                  type="number"
                  min={1}
                  max={2_000_000_000}
                  step={1}
                  required
                  value={points}
                  disabled={action.isPending}
                  onChange={(event) => {
                    setPoints(event.target.value);
                    edit();
                  }}
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                {t("reason")}
                <Textarea
                  required
                  maxLength={2000}
                  value={reason}
                  disabled={action.isPending}
                  onChange={(event) => {
                    setReason(event.target.value);
                    edit();
                  }}
                />
              </label>
              <Button type="submit" disabled={!canRequest || action.isPending}>
                {t("request")}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noTasks")}</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.07]">
                  {["task", "applicant", "points", "reason", "status", "decision"].map((key) => (
                    <th className="p-2 font-medium" key={key}>
                      {t(key)}
                    </th>
                  ))}
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
