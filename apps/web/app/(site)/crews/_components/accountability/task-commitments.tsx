"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import type { CrewTaskDTO } from "../../_hooks/types";
import { displayNameOf, useUserDisplays } from "../../_hooks/use-users";
import {
  useAccountabilityAction,
  useTaskCommitments,
  type Commitment,
} from "../../_hooks/use-accountability";

export function TaskCommitments(props: { task: CrewTaskDTO; canManage: boolean }) {
  const { user } = useCurrentUser();
  return (
    <TaskCommitmentSession key={`${user?.id}:${props.task.id}`} {...props} userId={user?.id} />
  );
}
function TaskCommitmentSession({
  task,
  canManage,
  userId,
}: {
  task: CrewTaskDTO;
  canManage: boolean;
  userId?: string;
}) {
  const t = useTranslations("crewAccountability");
  const query = useTaskCommitments(task.id);
  const action = useAccountabilityAction();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const records = query.data?.records ?? [];
  const displays = useUserDisplays([
    ...task.assignees.map((a) => a.userId),
    ...records.map((r) => r.userId),
  ]);
  const own = records.find((r) => r.userId === userId && r.currentAssignment);
  const assigned = task.assignees.some((a) => a.userId === userId);
  const active = !["submitted", "approved", "cancelled"].includes(task.status);
  async function submit(kind: "accept" | "at_risk" | "withdraw") {
    if (busy.current || query.isError) return;
    busy.current = true;
    setError("");
    try {
      await action.mutateAsync({
        path: `/crew-tasks/${encodeURIComponent(task.id)}/commitments`,
        body: {
          action: kind,
          expectedVersion: task.version,
          reason: kind === "accept" ? "" : reason.trim(),
        },
      });
      if (alive.current) setReason("");
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : t("failed"));
    } finally {
      if (alive.current) busy.current = false;
    }
  }
  return (
    <section className="my-6 space-y-3 border-t border-white/[0.06] pt-5 text-xs text-zinc-300">
      <h3 className="font-semibold text-zinc-100">{t("commitments")}</h3>
      <p className="text-zinc-400">{t("commitmentHelp")}</p>
      {query.isLoading && !query.data ? (
        <p role="status">{t("loading")}</p>
      ) : null}
      {query.isError && (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button size="sm" onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        </div>
      )}
      {query.data && (
        <fieldset disabled={query.isError} className="contents">
          {task.assignees
            .filter((a) => !records.some((r) => r.assignmentId === a.id))
            .map((a) => (
              <p key={a.id}>
                {displayNameOf(a.userId, displays)} · {t("pending")}
              </p>
            ))}
          {!task.assignees.length && !records.length && <p>{t("noAssignments")}</p>}
          {records.map((record) => (
            <div key={record.id} className="space-y-1 border-b border-white/[0.05] py-2">
              <p className="font-medium">
                {displayNameOf(record.userId, displays)} ·{" "}
                {t(
                  record.releasedAt
                    ? "handedOver"
                    : record.status === "withdrawn" && !record.acceptedAt
                      ? "declined"
                      : record.status
                )}
                {!record.currentAssignment && !record.releasedAt
                  ? ` · ${t("handoverPending")}`
                  : ""}
              </p>
              {record.promisedDueAt && (
                <p>
                  <time dateTime={record.promisedDueAt}>
                    {new Date(record.promisedDueAt).toLocaleString()}
                  </time>{" "}
                  · {t("promisedDeadline")}
                </p>
              )}
              {record.deadlineChanged && <p className="text-amber-300">{t("deadlineChanged")}</p>}
              {record.overdue && record.currentAssignment && (
                <p className="text-amber-300">{t("overdue")}</p>
              )}
              {record.reason && <p className="whitespace-pre-wrap break-words">{record.reason}</p>}
              {record.handoverNote && (
                <p className="whitespace-pre-wrap break-words">
                  {t("handover")}: {record.handoverNote}
                </p>
              )}
              {canManage &&
                (!record.currentAssignment || task.status === "cancelled") &&
                !record.releasedAt && <HandoverForm record={record} />}
            </div>
          ))}
          {assigned && active && own?.status !== "withdrawn" && (
            <div className="space-y-2">
              {!own?.acceptedAt && (
                <Button
                  size="sm"
                  disabled={action.isPending || !task.dueAt || new Date(task.dueAt) <= new Date()}
                  onClick={() => void submit("accept")}
                >
                  {t("accept")}
                </Button>
              )}
              {!own?.acceptedAt && (!task.dueAt || new Date(task.dueAt) <= new Date()) && (
                <p>{t("futureDeadline")}</p>
              )}
              <Textarea
                aria-label={t("reason")}
                placeholder={t("reasonHelp")}
                value={reason}
                maxLength={2000}
                disabled={action.isPending}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {!!own?.acceptedAt && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={action.isPending || reason.trim().length < 3}
                    onClick={() => void submit("at_risk")}
                  >
                    {t("reportRisk")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.isPending || reason.trim().length < 3}
                  onClick={() => void submit("withdraw")}
                >
                  {t(own?.acceptedAt ? "withdrawTask" : "declineTask")}
                </Button>
              </div>
            </div>
          )}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
function HandoverForm({ record }: { record: Commitment }) {
  const t = useTranslations("crewAccountability");
  const action = useAccountabilityAction();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy.current) return;
        busy.current = true;
        setError("");
        try {
          await action.mutateAsync({
            path: `/crew-commitments/${encodeURIComponent(record.id)}/handover`,
            body: { note: note.trim() },
          });
        } catch (err) {
          if (alive.current) setError(err instanceof Error ? err.message : t("failed"));
        } finally {
          if (alive.current) busy.current = false;
        }
      }}
    >
      <p className="text-zinc-400">{t("handoverHelp")}</p>
      <Textarea
        aria-label={t("handover")}
        value={note}
        maxLength={2000}
        disabled={action.isPending}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button type="submit" size="sm" disabled={action.isPending || note.trim().length < 3}>
        {t("closeHandover")}
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
