"use client";

import { useEffect, useRef, useState } from "react";
import { PRESET_POSITIONS } from "@repo/shared/crew";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";
import { useTranslations } from "@/src/i18n/i18n";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import type {
  CrewMemberDTO,
  CrewTaskDTO,
  CrewTaskListItemDTO,
} from "@/app/(site)/crews/_hooks/types";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { batchAssignment, batchRecruitment, canBatchTask } from "./workbench-batch-input";

export function WorkbenchBatchActions({
  crewId,
  mode,
  tasks,
  members,
  onClose,
  onChanged,
}: {
  crewId: string;
  mode: "assign" | "recruit";
  tasks: CrewTaskListItemDTO[];
  members: CrewMemberDTO[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("crewTaskProject.workbench");
  const roleT = useTranslations("crew.position");
  const displays = useUserDisplays(members.map((member) => member.userId));
  const [assignee, setAssignee] = useState("");
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // A lost response may follow a committed write. Refresh before a new attempt.
  const [attempted, setAttempted] = useState(false);
  const eligible = tasks.length > 0 && tasks.every(canBatchTask);
  const valid =
    eligible &&
    (mode === "assign"
      ? Boolean(assignee)
      : tasks.every((task) =>
          PRESET_POSITIONS.some((role) => role.value === (roles[task.id] ?? task.positionRole))
        ));

  async function submit() {
    if (lock.current || attempted || !valid) return;
    lock.current = true;
    setBusy(true);
    setAttempted(true);
    try {
      for (const selected of tasks) {
        if (!alive.current) break;
        const task = await crewApi.get<CrewTaskDTO>(
          `/crew-tasks/${encodeURIComponent(selected.id)}`,
          { cache: "no-store" }
        );
        if (!alive.current) break;
        if (task.crewId !== crewId || task.version !== selected.version || !canBatchTask(task)) {
          throw new Error(t("batchChanged", { title: selected.title }));
        }
        if (mode === "assign") {
          await crewApi.patch(`/crew-tasks/${encodeURIComponent(task.id)}`, {
            body: batchAssignment(task, assignee),
          });
        } else {
          await crewApi.post(`/crews/${encodeURIComponent(crewId)}/positions`, {
            body: batchRecruitment(task, roles[task.id] ?? task.positionRole ?? ""),
          });
        }
        if (alive.current) setCompleted((current) => [...current, task.id]);
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : t("failed"));
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        onChanged();
      }
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !lock.current) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(mode === "assign" ? "batchAssign" : "batchRecruit")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("batchTerms")}</p>
          {mode === "assign" ? (
            <label className="grid gap-2 text-sm">
              {t("batchMember")}
              <NativeSelect
                className="rounded-md border border-white/15 bg-background p-2"
                value={assignee}
                disabled={busy || attempted}
                onChange={setAssignee}
              >
                <NativeSelectOption value="">{t("batchChooseMember")}</NativeSelectOption>
                {members
                  .filter((member) => member.status === "active")
                  .map((member) => (
                    <NativeSelectOption key={member.userId} value={member.userId}>
                      {displayNameOf(member.userId, displays)}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </label>
          ) : null}
          <ul className="max-h-72 space-y-3 overflow-auto">
            {tasks.map((task) => (
              <li key={task.id} className="grid gap-2 border-b border-white/10 pb-3 text-sm">
                <span>
                  {task.title}
                  {completed.includes(task.id) ? ` · ${t("batchDone")}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {task.rewardCurrency}{" "}
                  {task.rewardUsdMinor == null ? "—" : (task.rewardUsdMinor / 100).toFixed(2)} ·{" "}
                  {task.paymentTerms ?? "—"}
                </span>
                {mode === "recruit" ? (
                  <NativeSelect
                    aria-label={t("batchRole", { title: task.title })}
                    disabled={busy || attempted}
                    value={roles[task.id] ?? task.positionRole ?? ""}
                    onChange={(value) => setRoles((current) => ({ ...current, [task.id]: value }))}
                    className="rounded-md border border-white/15 bg-background p-2"
                  >
                    <NativeSelectOption value="">{t("batchChooseRole")}</NativeSelectOption>
                    {PRESET_POSITIONS.map((role) => (
                      <NativeSelectOption key={role.value} value={role.value}>
                        {roleT(role.value)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : null}
              </li>
            ))}
          </ul>
          {!eligible ? (
            <p role="alert" className="text-sm text-destructive">
              {t("batchEligibility")}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error} {t("batchRetryHelp")}
            </p>
          ) : null}
          {attempted ? (
            <p role="status" className="text-sm">
              {t("batchProgress", { count: completed.length, total: tasks.length })}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button variant="outline" color="muted" disabled={busy} onClick={onClose}>
              {t("batchClose")}
            </Button>
            <Button disabled={!valid || busy || attempted} onClick={() => void submit()}>
              {t(mode === "assign" ? "batchAssign" : "batchRecruit")}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
