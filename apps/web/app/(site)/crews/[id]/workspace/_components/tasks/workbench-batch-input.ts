import type {
  CreatePositionInput,
  CrewTaskListItemDTO,
  UpdateCrewTaskInput,
} from "@/app/(site)/crews/_hooks/types";
import { CREW_CURRENCY } from "@/src/lib/crew-money";

// Both batch endpoints accept at most 100 tasks per atomic operation.
export const MAX_BATCH_TASKS = 100;

export function canBatchTask(task: CrewTaskListItemDTO): boolean {
  return (
    Array.isArray(task.assignees) &&
    !task.assignees.length &&
    !task.isRecruiting &&
    ["open", "in_progress", "revision_requested"].includes(task.status)
  );
}

export function batchAssignment(task: CrewTaskListItemDTO, userId: string): UpdateCrewTaskInput {
  return {
    expectedVersion: task.version,
    assignees: [
      {
        userId,
        currency: task.rewardCurrency ?? CREW_CURRENCY,
        rewardAmountMinor: task.rewardUsdMinor ?? null,
      },
    ],
  };
}

export function batchRecruitment(
  task: CrewTaskListItemDTO,
  positionType: string
): CreatePositionInput {
  const amount = task.rewardUsdMinor;
  return {
    taskId: task.id,
    expectedTaskVersion: task.version,
    recruitmentVisibility: "public",
    positionType,
    description: task.description || task.title,
    targetCount: 1,
    workMode: "remote",
    employmentType: "project_based",
    requiredSkills: task.requiredSkills ?? [],
    paymentTerms: task.paymentTerms,
    closeDate: task.dueAt?.slice(0, 10),
    revenueSharePercent: task.profitShareBps ? task.profitShareBps / 100 : undefined,
    salary:
      amount == null
        ? { negotiable: true }
        : {
            currency: task.rewardCurrency ?? CREW_CURRENCY,
            period: "project",
            min: amount / 100,
            max: amount / 100,
            negotiable: false,
          },
  };
}
