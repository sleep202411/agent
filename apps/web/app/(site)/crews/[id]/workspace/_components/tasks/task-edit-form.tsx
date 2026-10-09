"use client";

import { useState } from "react";
import {
  useUpdateCrewTask,
  type CrewTaskDTO,
  type CreateCrewTaskInput,
} from "@/app/(site)/crews/_hooks/use-crew";
import { TaskQuickCreate } from "./task-quick-create";
import type { ComponentProps } from "react";

export function taskFormInput(task: CrewTaskDTO): CreateCrewTaskInput {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    workflowStateId: task.workflowStateId,
    taskKind: task.taskKind,
    ...(task.taskKind === "art"
      ? {
          assetCategory: (["characters", "scenes", "props"].includes(task.assetCategory ?? "")
            ? task.assetCategory
            : "art") as "characters" | "scenes" | "props" | "art",
        }
      : {}),
    startAt: task.startAt,
    dueAt: task.dueAt,
    requiredSkills: task.requiredSkills,
    positionRole: task.positionRole,
    contractAssetNodeId: task.contractAssetNodeId,
    paymentTerms: task.paymentTerms,
    rewardCurrency: task.rewardCurrency,
    rewardUsdMinor: task.rewardUsdMinor,
    profitShareBps: task.profitShareBps,
    estimatePoints: task.estimatePoints,
    computeBudgetPoints: task.computeBudgetPoints,
    revisionLimit: task.revisionLimit,
    cycleId: task.cycleId,
    episodeId: task.episodeId,
    parentId: task.parentId,
    blockedByTaskIds: task.blockedBy.map((item) => item.id),
    customFieldValues: task.customFieldValues.map(({ fieldId, value }) => ({ fieldId, value })),
    labelIds: task.labels.map((item) => item.id),
    assignees: task.assignees.map(({ userId, currency, rewardAmountMinor }) => ({
      userId,
      currency,
      rewardAmountMinor,
    })),
  };
}

type Props = Pick<
  ComponentProps<typeof TaskQuickCreate>,
  "crewName" | "members" | "project" | "activeView" | "onOpenChange"
> & { task: CrewTaskDTO };

export function TaskEditForm({ task, ...props }: Props) {
  // Keep the version that populated the form: background refetches must not
  // silently upgrade a stale edit's optimistic concurrency token.
  const [original] = useState(task);
  const [initialInput] = useState(() => taskFormInput(task));
  const update = useUpdateCrewTask(task.crewId);
  return (
    <TaskQuickCreate
      {...props}
      open
      crewId={task.crewId}
      keyboardShortcut={false}
      initialInput={initialInput}
      saving={update.isPending}
      onSave={async (input) => {
        const changed = Object.fromEntries(
          Object.entries(input).filter(
            ([key, value]) =>
              key !== "rewardCurrency" &&
              JSON.stringify(value) !==
                JSON.stringify(initialInput[key as keyof CreateCrewTaskInput])
          )
        );
        if (!Object.keys(changed).length) return original;
        return update.mutateAsync({
          taskId: original.id,
          input: { ...changed, expectedVersion: original.version },
        });
      }}
    />
  );
}
