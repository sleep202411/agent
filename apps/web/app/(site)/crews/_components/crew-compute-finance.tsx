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
import {
  useComputeRequests,
  useComputeRequestAction,
  useComputeWorkspaceSetup,
} from "../_hooks/use-compute-requests";
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
  const action = useComputeRequestAction(crewId);
  const setup = useComputeWorkspaceSetup(crewId);
  const parsed = useMemo(() => computeRequestsPageSchema.safeParse(query.data), [query.data]);
  const data = parsed.success ? parsed.data : undefined;
  const [taskId, setTaskId] = useState(initialTaskId ?? "");
  const [beneficiary, setBeneficiary] = useState("");
  const assignees = data?.tasks.find((task) => task.id === taskId)?.assignees ?? [];
  const beneficiaryUserId = assignees.length === 1 ? assignees[0]!.userId : beneficiary;
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const requestKey = useRef<string | undefined>(undefined);
  const displays = useUserDisplays([
    ...(data?.tasks.flatMap((task) => task.assignees?.map((a) => a.userId) ?? []) ?? []),
    ...(data?.taskUsage?.map((row) => row.userId) ?? []),
    ...(data?.items.flatMap((row) => [
      row.userId,
      ...(row.decidedByUserId ? [row.decidedByUserId] : []),
    ]) ?? []),
  ]);
  const number = Number(points);
  const canRequest =
    data?.isOwner &&
    data.workspaceLinked !== false &&
    assignees.some((a) => a.userId === beneficiaryUserId) &&
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
            {!data.isOwner ? (
              <p role="status" className="rounded-xl bg-white/5 p-4 text-sm">
                {t("ownerOnly")}
              </p>
            ) : data.workspaceLinked === false ? (
              <div className="space-y-3 rounded-xl bg-white/5 p-4 text-sm">
                <p role="status">{t("workspaceRequired")}</p>
                <Button
                  disabled={setup.isPending}
                  onClick={() => setup.mutate(undefined, { onError: error })}
                >
                  {t("setupWorkspace")}
                </Button>
              </div>
            ) : data.tasks.length ? (
              <form
                className="grid content-start gap-4 rounded-xl bg-white/[0.025] p-4 sm:grid-cols-2 xl:grid-cols-1 [&>label]:min-w-0"
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
                    {
                      taskId,
                      beneficiaryUserId,
                      points: number,
                      reason: reason.trim(),
                      requestKey: key,
                    },
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
                      setBeneficiary("");
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
                  {t("creator")}
                  <NativeSelect
                    aria-label={t("creator")}
                    value={beneficiaryUserId}
                    disabled={action.isPending}
                    onChange={(value) => {
                      setBeneficiary(value);
                      edit();
                    }}
                  >
                    <NativeSelectOption value="">{t("selectCreator")}</NativeSelectOption>
                    {assignees.map((a) => (
                      <NativeSelectOption key={a.userId} value={a.userId}>
                        {displayNameOf(a.userId, displays)}
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
                <label className="space-y-1 text-sm sm:col-span-2 xl:col-span-1">
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
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
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
