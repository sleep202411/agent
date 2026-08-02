import type {
  CrewTaskListItemDTO,
  CrewTaskPageDTO,
  CrewTaskWorkflowStateDTO,
} from "../_hooks/types";

export type BoardOrder = Record<string, string[]>;

export interface BoardPlacement {
  workflowStateId: string;
  beforeTaskId: string | null;
  afterTaskId: string | null;
}

export interface ReorderCrewTaskCommand {
  expectedVersion: number;
  beforeTaskId: string | null;
  beforeTaskVersion: number | null;
  afterTaskId: string | null;
  afterTaskVersion: number | null;
  workflowStateId?: string;
  cycleId?: string | null;
}

export function createBoardOrder(
  tasks: CrewTaskListItemDTO[],
  workflowStateIds: string[]
): BoardOrder {
  const order = Object.fromEntries(workflowStateIds.map((stateId) => [stateId, [] as string[]]));
  for (const task of tasks) {
    order[task.workflowStateId]?.push(task.id);
  }
  return order;
}

/**
 * Projects a task into a concrete column/index without mutating the source
 * order. The target index is interpreted after the source has been removed,
 * which makes repeated drag-over projections idempotent.
 */
export function moveBoardTask(
  order: BoardOrder,
  taskId: string,
  workflowStateId: string,
  targetIndex: number
): BoardOrder {
  if (!order[workflowStateId]) return order;
  const sourceStateId = Object.keys(order).find((candidate) => order[candidate]?.includes(taskId));
  if (!sourceStateId) return order;

  const sourceItems = order[sourceStateId] ?? [];
  const sourceIndex = sourceItems.indexOf(taskId);
  const withoutSource = sourceItems.filter((id) => id !== taskId);
  const targetWithoutSource =
    sourceStateId === workflowStateId
      ? withoutSource
      : (order[workflowStateId] ?? []).filter((id) => id !== taskId);
  const insertionIndex = clamp(targetIndex, 0, targetWithoutSource.length);

  if (sourceStateId === workflowStateId && sourceIndex === insertionIndex) return order;

  const next = Object.fromEntries(
    Object.entries(order).map(([stateId, taskIds]) => [stateId, [...taskIds]])
  );
  next[sourceStateId] = withoutSource;
  next[workflowStateId] = [
    ...targetWithoutSource.slice(0, insertionIndex),
    taskId,
    ...targetWithoutSource.slice(insertionIndex),
  ];
  return next;
}

export function placementForTask(order: BoardOrder, taskId: string): BoardPlacement | null {
  const entry = Object.entries(order).find(([, taskIds]) => taskIds.includes(taskId));
  if (!entry) return null;
  const [workflowStateId, taskIds] = entry;
  const index = taskIds.indexOf(taskId);
  return {
    workflowStateId,
    beforeTaskId: taskIds[index - 1] ?? null,
    afterTaskId: taskIds[index + 1] ?? null,
  };
}

export function boardOrdersEqual(left: BoardOrder, right: BoardOrder) {
  const leftStateIds = Object.keys(left);
  const rightStateIds = Object.keys(right);
  return (
    leftStateIds.length === rightStateIds.length &&
    leftStateIds.every(
      (stateId) =>
        right[stateId] != null &&
        left[stateId]?.length === right[stateId]?.length &&
        left[stateId]?.every((taskId, index) => taskId === right[stateId]?.[index])
    )
  );
}

/**
 * Mirrors the server's rank calculation so every query consumer sees the
 * dropped card immediately. The server response remains authoritative and
 * replaces this provisional rank on success.
 */
export function optimisticallyReorderCrewTasks(
  tasks: CrewTaskListItemDTO[],
  taskId: string,
  input: ReorderCrewTaskCommand,
  destinationState: CrewTaskWorkflowStateDTO
) {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return tasks;
  const targetStateId = input.workflowStateId ?? task.workflowStateId;

  const before = input.beforeTaskId
    ? (tasks.find((candidate) => candidate.id === input.beforeTaskId) ?? null)
    : null;
  const after = input.afterTaskId
    ? (tasks.find((candidate) => candidate.id === input.afterTaskId) ?? null)
    : null;
  const targetCycleId = input.cycleId === undefined ? task.cycleId : input.cycleId;
  const rank = optimisticRank(tasks, taskId, targetStateId, before, after);
  const now = new Date().toISOString();

  const updated = tasks.map((candidate) =>
    candidate.id === taskId
      ? {
          ...candidate,
          status: destinationState.semantic,
          workflowStateId: destinationState.id,
          workflowState: destinationState,
          cycleId: targetCycleId,
          rank,
          version: candidate.version + 1,
          updatedAt: now,
        }
      : candidate
  );
  const moved = updated.find((candidate) => candidate.id === taskId);
  if (!moved) return tasks;

  const withoutMoved = updated.filter((candidate) => candidate.id !== taskId);
  let insertionIndex = withoutMoved.length;
  if (input.beforeTaskId) {
    const beforeIndex = withoutMoved.findIndex((candidate) => candidate.id === input.beforeTaskId);
    if (beforeIndex >= 0) insertionIndex = beforeIndex + 1;
  } else if (input.afterTaskId) {
    const afterIndex = withoutMoved.findIndex((candidate) => candidate.id === input.afterTaskId);
    if (afterIndex >= 0) insertionIndex = afterIndex;
  } else {
    const lastDestinationIndex = withoutMoved.findLastIndex(
      (candidate) => candidate.workflowStateId === targetStateId
    );
    if (lastDestinationIndex >= 0) insertionIndex = lastDestinationIndex + 1;
  }

  return [...withoutMoved.slice(0, insertionIndex), moved, ...withoutMoved.slice(insertionIndex)];
}

export function optimisticallyReorderCrewTaskPages(
  pages: CrewTaskPageDTO[],
  taskId: string,
  input: ReorderCrewTaskCommand,
  destinationState: CrewTaskWorkflowStateDTO
): CrewTaskPageDTO[] {
  const items = pages.flatMap((page) => page.items);
  const original = items.find((task) => task.id === taskId);
  if (!original) return pages;

  const reordered = optimisticallyReorderCrewTasks(items, taskId, input, destinationState);
  const counts = { ...(pages[0]?.workflowCounts ?? {}) };
  if (original.workflowStateId !== destinationState.id) {
    counts[original.workflowStateId] = Math.max(0, (counts[original.workflowStateId] ?? 0) - 1);
    counts[destinationState.id] = (counts[destinationState.id] ?? 0) + 1;
  }

  let offset = 0;
  return pages.map((page, index) => {
    const pageItems = reordered.slice(offset, offset + page.items.length);
    offset += page.items.length;
    return {
      ...page,
      items: pageItems,
      workflowCounts: index === 0 ? counts : page.workflowCounts,
    };
  });
}

function optimisticRank(
  tasks: CrewTaskListItemDTO[],
  taskId: string,
  workflowStateId: string,
  before: CrewTaskListItemDTO | null,
  after: CrewTaskListItemDTO | null
) {
  if (before && after) return String((Number(before.rank) + Number(after.rank)) / 2);
  if (before) return String(Number(before.rank) + 1024);
  if (after) return String(Number(after.rank) / 2);
  const lastRank = tasks
    .filter((candidate) => candidate.id !== taskId && candidate.workflowStateId === workflowStateId)
    .reduce((maximum, candidate) => Math.max(maximum, Number(candidate.rank)), 0);
  return String(lastRank + 1024);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
