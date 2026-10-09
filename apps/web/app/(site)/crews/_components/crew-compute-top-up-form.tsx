"use client";

import { useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useTranslations } from "@/src/i18n/i18n";
import { computeRequestsPageSchema } from "../_hooks/compute-requests-data";
import {
  useComputeRequests,
  useComputeRequestAction,
  useComputeWorkspaceSetup,
} from "../_hooks/use-compute-requests";
import { displayNameOf, useUserDisplays } from "../_hooks/use-users";

const units = ["minutes", "hours", "days", "person_days", "percent"] as const;
export function CrewComputeTopUpForm({
  crewId,
  crewName,
  initialTaskId,
  onClose,
}: {
  crewId: string;
  crewName: string;
  initialTaskId?: string;
  onClose?: () => void;
}) {
  const t = useTranslations("crewComputeFinance");
  const query = useComputeRequests(crewId);
  const action = useComputeRequestAction(crewId);
  const setup = useComputeWorkspaceSetup(crewId);
  const parsed = computeRequestsPageSchema.safeParse(query.data);
  const data = parsed.success ? parsed.data : undefined;
  const [taskId, setTaskId] = useState(initialTaskId ?? "");
  const [beneficiary, setBeneficiary] = useState("");
  const [points, setPoints] = useState("");
  const [workload, setWorkload] = useState("");
  const [unit, setUnit] = useState<(typeof units)[number]>("minutes");
  const [reason, setReason] = useState("");
  const [submittedTask, setSubmittedTask] = useState<string>();
  const requestKey = useRef<string | undefined>(undefined);
  const task = data?.tasks.find((row) => row.id === taskId);
  const assignees = task?.assignees ?? [];
  const recipient = assignees.length === 1 ? assignees[0]!.userId : beneficiary;
  const displays = useUserDisplays(assignees.map((a) => a.userId));
  const edit = () => {
    requestKey.current = undefined;
  };
  const error = (cause: unknown) =>
    toast.error(cause instanceof Error ? cause.message : String(cause));
  const alreadyApplied = task?.topUpRequested || submittedTask === taskId;
  const valid =
    data?.isOwner &&
    data.workspaceLinked &&
    task &&
    !alreadyApplied &&
    assignees.some((a) => a.userId === recipient) &&
    Number.isInteger(Number(points)) &&
    Number(points) >= 1 &&
    Number(points) <= 500 &&
    Number(workload) > 0 &&
    Number(workload) <= (unit === "percent" ? 100 : 999_999_999_999) &&
    reason.trim();

  if (query.isPending) return <p role="status">{t("loading")}</p>;
  if (query.isError || !data)
    return (
      <div role="alert">
        {query.error?.message ?? t("loadFailed")}
        <Button onClick={() => void query.refetch()}>{t("retry")}</Button>
      </div>
    );
  if (!data.isOwner) return <p role="status">{t("ownerOnly")}</p>;
  if (!data.workspaceLinked)
    return (
      <div className="space-y-3">
        <p>{t("workspaceRequired")}</p>
        <Button
          disabled={setup.isPending}
          onClick={() => setup.mutate(undefined, { onError: error })}
        >
          {t("setupWorkspace")}
        </Button>
      </div>
    );

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || action.isPending) return;
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
            beneficiaryUserId: recipient,
            points: Number(points),
            remainingWorkload: Number(workload),
            workloadUnit: unit,
            reason: reason.trim(),
            requestKey: key,
          },
          {
            onError: error,
            onSuccess: () => {
              setSubmittedTask(taskId);
              toast.success(t("topUpSubmitted"));
              onClose?.();
            },
          }
        );
      }}
    >
      <p className="text-sm text-muted-foreground">{t("topUpPolicy")}</p>
      <label className="block space-y-1 text-sm">
        {t("project")}
        <Input readOnly value={crewName} />
      </label>
      <label className="block space-y-1 text-sm">
        {t("task")}
        {initialTaskId ? (
          <Input readOnly value={task?.title ?? t("noTasks")} />
        ) : (
          <NativeSelect
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
            {data.tasks.map((row) => (
              <NativeSelectOption key={row.id} value={row.id}>
                TASK-{row.number} · {row.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </label>
      <label className="block space-y-1 text-sm">
        {t("creator")}
        <NativeSelect
          aria-label={t("creator")}
          value={recipient}
          disabled={action.isPending || alreadyApplied}
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
      {task && !assignees.length && (
        <p role="status" className="text-sm">
          {t("assignFirst")}
        </p>
      )}
      {alreadyApplied && (
        <p role="status" className="text-sm">
          {t("topUpAlreadyApplied")}
        </p>
      )}
      <fieldset disabled={action.isPending || alreadyApplied} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm">
            {t("remainingWorkload")}
            <Input
              type="number"
              required
              min={0.01}
              max={unit === "percent" ? 100 : 999_999_999_999}
              step={0.01}
              value={workload}
              onChange={(e) => {
                setWorkload(e.target.value);
                edit();
              }}
            />
          </label>
          <label className="space-y-1 text-sm">
            {t("workloadUnit")}
            <NativeSelect
              aria-label={t("workloadUnit")}
              value={unit}
              onChange={(value) => {
                setUnit(value as typeof unit);
                edit();
              }}
            >
              {units.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {t(`workloadUnits.${value}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        </div>
        <label className="block space-y-1 text-sm">
          {t("points")}
          <Input
            required
            type="number"
            min={1}
            max={500}
            step={1}
            value={points}
            onChange={(e) => {
              setPoints(e.target.value);
              edit();
            }}
          />
        </label>
        <label className="block space-y-1 text-sm">
          {t("reason")}
          <Textarea
            required
            maxLength={2000}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              edit();
            }}
          />
        </label>
      </fieldset>
      <div className="flex justify-end gap-3">
        {onClose && (
          <Button type="button" variant="outline" disabled={action.isPending} onClick={onClose}>
            {t("cancel")}
          </Button>
        )}
        <Button type="submit" disabled={!valid || action.isPending}>
          {t("request")}
        </Button>
      </div>
    </form>
  );
}
