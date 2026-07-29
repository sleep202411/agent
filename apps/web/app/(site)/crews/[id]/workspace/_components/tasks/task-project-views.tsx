"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconDots,
  IconGripVertical,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LookupUserDTO } from "@repo/shared/users";

import { cn } from "@/lib/utils";
import type {
  CrewTaskCycleDTO,
  CrewTaskListItemDTO,
  CrewTaskFieldDTO,
  CrewTaskPriority,
  CrewTaskViewDTO,
  CrewTaskWorkflowStateDTO,
  UpdateCrewTaskInput,
} from "@/app/(site)/crews/_hooks/use-crew";
import {
  boardOrdersEqual,
  createBoardOrder,
  moveBoardTask,
  placementForTask,
} from "@/app/(site)/crews/_lib/task-board-ordering";
import { displayNameOf } from "@/app/(site)/crews/_hooks/use-users";
import { useTranslations } from "@/src/i18n/i18n";

type Displays = Map<string, LookupUserDTO>;
interface TaskProjectViewProps {
  tasks: CrewTaskListItemDTO[];
  workflowCounts?: Record<string, number>;
  view: CrewTaskViewDTO;
  cycles: CrewTaskCycleDTO[];
  fields: CrewTaskFieldDTO[];
  workflowStates: CrewTaskWorkflowStateDTO[];
  displays: Displays;
  selectedIds: Set<string>;
  canManage: boolean;
  onToggleSelected: (taskId: string) => void;
  onToggleAll: (taskIds: string[]) => void;
  onOpenTask: (taskId: string) => void;
  onQuickUpdate: (
    task: CrewTaskListItemDTO,
    input: Omit<UpdateCrewTaskInput, "expectedVersion">
  ) => void;
  onMoveTask: (
    task: CrewTaskListItemDTO,
    workflowState: CrewTaskWorkflowStateDTO,
    previousTaskId: string | null,
    nextTaskId: string | null
  ) => Promise<void>;
  onCreateWorkflowState: (afterStateId: string | null) => void;
  onEditWorkflowState: (state: CrewTaskWorkflowStateDTO) => void;
}

export function TaskProjectView(props: TaskProjectViewProps) {
  switch (props.view.layout) {
    case "board":
      return <BoardView {...props} />;
    case "calendar":
      return <CalendarView {...props} />;
    case "timeline":
      return <TimelineView {...props} />;
    default:
      return <TableView {...props} />;
  }
}

function TableView({
  tasks,
  view,
  cycles,
  fields,
  workflowStates,
  displays,
  selectedIds,
  canManage,
  onToggleSelected,
  onToggleAll,
  onOpenTask,
  onQuickUpdate,
}: TaskProjectViewProps) {
  const t = useTranslations("crewTaskProject");
  const columns = useMemo(
    () => resolveTableColumns(view.visibleFields, fields),
    [fields, view.visibleFields]
  );
  const gridTemplateColumns = useMemo(
    () =>
      ["42px", "90px", "minmax(280px,1fr)", ...columns.map((column) => columnWidth(column))].join(
        " "
      ),
    [columns]
  );
  const minWidth = useMemo(
    () =>
      Math.max(980, 412 + columns.reduce((total, column) => total + columnWidthPixels(column), 0)),
    [columns]
  );
  const groups = useMemo(() => {
    if (!view.groupBy) {
      return [{ key: "all", label: null, tasks, priority: null }];
    }
    if (view.groupBy === "priority") {
      return (["urgent", "high", "normal", "low"] as CrewTaskPriority[])
        .map((priority) => ({
          key: priority,
          label: t(`priority.${priority}`),
          tasks: tasks.filter((task) => task.priority === priority),
          priority,
        }))
        .filter((group) => group.tasks.length > 0);
    }
    if (view.groupBy === "status") {
      return workflowStates
        .map((state) => ({
          key: state.id,
          label: workflowStateLabel(t, state),
          tasks: tasks.filter((task) => task.workflowStateId === state.id),
          priority: null,
        }))
        .filter((group) => group.tasks.length > 0);
    }
    if (view.groupBy === "cycle") {
      return [
        {
          key: "backlog",
          label: t("backlog"),
          tasks: tasks.filter((task) => task.cycleId == null),
          priority: null,
        },
        ...cycles.map((cycle) => ({
          key: cycle.id,
          label: cycle.name,
          tasks: tasks.filter((task) => task.cycleId === cycle.id),
          priority: null,
        })),
      ].filter((group) => group.tasks.length > 0);
    }
    if (view.groupBy === "assignee") {
      const userIds = [
        ...new Set(tasks.flatMap((task) => task.assignees.map((assignee) => assignee.userId))),
      ];
      return [
        {
          key: "unassigned",
          label: t("unassigned"),
          tasks: tasks.filter((task) => task.assignees.length === 0),
          priority: null,
        },
        ...userIds.map((userId) => ({
          key: userId,
          label: displayNameOf(userId, displays),
          tasks: tasks.filter((task) =>
            task.assignees.some((assignee) => assignee.userId === userId)
          ),
          priority: null,
        })),
      ].filter((group) => group.tasks.length > 0);
    }
    return [{ key: "all", label: null, tasks, priority: null }];
  }, [cycles, displays, tasks, t, view.groupBy, workflowStates]);
  const allSelected = tasks.length > 0 && tasks.every((task) => selectedIds.has(task.id));

  return (
    <div style={{ minWidth }}>
      <div
        className="grid h-10 items-center border-b border-white/[0.07] bg-[#0a0b0e] px-2 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#626873]"
        style={{ gridTemplateColumns }}
      >
        <label className="grid place-items-center">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onToggleAll(tasks.map((task) => task.id))}
            className="size-3.5 rounded border-white/15 bg-transparent accent-[#e12b32]"
            aria-label={t("selectAll")}
          />
        </label>
        <span>{t("field.number")}</span>
        <span>{t("field.task")}</span>
        {columns.map((column) => (
          <span key={column} className="truncate pr-3">
            {column.startsWith("custom:")
              ? fields.find((field) => `custom:${field.id}` === column)?.name
              : t(`field.${column}`)}
          </span>
        ))}
      </div>
      {groups.map((group) => (
        <section key={group.key}>
          {group.label ? (
            <div className="flex h-9 items-center gap-2 border-b border-white/[0.055] bg-white/[0.018] px-4 text-[10px] font-semibold text-[#aeb3bc]">
              {group.priority ? <PriorityMark priority={group.priority} /> : null}
              {group.label}
              <span className="font-normal text-[#5d636e]">{group.tasks.length}</span>
            </div>
          ) : null}
          {group.tasks.map((task) => {
            const immutable = task.status === "approved" || task.status === "cancelled";
            return (
              <div
                key={task.id}
                className={cn(
                  "group grid min-h-12 items-center border-b border-white/[0.052] px-2 text-[11px] transition-colors hover:bg-white/[0.028]",
                  selectedIds.has(task.id) && "bg-red-500/[0.035]"
                )}
                style={{ gridTemplateColumns }}
              >
                <label className="grid place-items-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(task.id)}
                    onChange={() => onToggleSelected(task.id)}
                    className="size-3.5 rounded border-white/15 bg-transparent accent-[#e12b32]"
                    aria-label={t("selectTask", { number: task.number })}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="text-left font-mono text-[10px] text-[#626975] hover:text-[#b8bdc5]"
                >
                  #{task.number}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="min-w-0 pr-5 text-left"
                >
                  <span className="block truncate font-medium text-[#d9dce1] group-hover:text-white">
                    {task.title}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[9px] text-[#606672]">
                    {task.parent ? (
                      <span className="font-mono">↳ #{task.parent.number}</span>
                    ) : null}
                    {task.subtaskProgress.total > 0 ? (
                      <span>
                        {t("subtaskProgress", {
                          completed: task.subtaskProgress.completed,
                          total: task.subtaskProgress.total,
                        })}
                      </span>
                    ) : null}
                    {task.blockedBy.some((blocker) => !blocker.resolved) ? (
                      <span className="text-amber-300">{t("blocked")}</span>
                    ) : null}
                    {task.labels.slice(0, 2).map((label) => (
                      <span
                        key={label.id}
                        className="rounded px-1.5 py-0.5"
                        style={{ color: label.color, backgroundColor: `${label.color}18` }}
                      >
                        {label.name}
                      </span>
                    ))}
                  </span>
                </button>
                {columns.map((column) => (
                  <TaskTableField
                    key={column}
                    column={column}
                    task={task}
                    field={
                      column.startsWith("custom:")
                        ? fields.find((candidate) => `custom:${candidate.id}` === column)
                        : undefined
                    }
                    cycles={cycles}
                    workflowStates={workflowStates}
                    displays={displays}
                    canManage={canManage}
                    immutable={immutable}
                    onOpenTask={onOpenTask}
                    onQuickUpdate={onQuickUpdate}
                  />
                ))}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

const DEFAULT_TABLE_COLUMNS = [
  "status",
  "priority",
  "assignees",
  "estimate",
  "cycle",
  "dueAt",
] as const;

const BUILT_IN_TABLE_COLUMNS = new Set([
  "status",
  "priority",
  "assignees",
  "cycle",
  "labels",
  "estimate",
  "points",
  "startAt",
  "dueAt",
  "updatedAt",
  "parent",
  "subtasks",
  "blockedBy",
]);

function resolveTableColumns(visibleFields: string[], fields: CrewTaskFieldDTO[]) {
  const customColumns = new Set(fields.map((field) => `custom:${field.id}`));
  const requested = visibleFields.length ? visibleFields : [...DEFAULT_TABLE_COLUMNS];
  return [...new Set(requested)].filter(
    (column) => BUILT_IN_TABLE_COLUMNS.has(column) || customColumns.has(column)
  );
}

function columnWidth(column: string) {
  return `${columnWidthPixels(column)}px`;
}

function columnWidthPixels(column: string) {
  if (column.startsWith("custom:")) return 148;
  switch (column) {
    case "status":
      return 132;
    case "priority":
      return 124;
    case "assignees":
      return 144;
    case "cycle":
      return 128;
    case "labels":
      return 172;
    case "parent":
    case "blockedBy":
      return 152;
    case "subtasks":
      return 116;
    default:
      return 108;
  }
}

function TaskTableField({
  column,
  task,
  field,
  cycles,
  workflowStates,
  displays,
  canManage,
  immutable,
  onOpenTask,
  onQuickUpdate,
}: {
  column: string;
  task: CrewTaskListItemDTO;
  field?: CrewTaskFieldDTO;
  cycles: CrewTaskCycleDTO[];
  workflowStates: CrewTaskWorkflowStateDTO[];
  displays: Displays;
  canManage: boolean;
  immutable: boolean;
  onOpenTask: (taskId: string) => void;
  onQuickUpdate: (
    task: CrewTaskListItemDTO,
    input: Omit<UpdateCrewTaskInput, "expectedVersion">
  ) => void;
}) {
  const t = useTranslations("crewTaskProject");

  switch (column) {
    case "status":
      return (
        <select
          value={task.workflowStateId}
          disabled={!canManage || immutable || task.status === "submitted"}
          onChange={(event) =>
            onQuickUpdate(task, {
              workflowStateId: event.target.value,
            })
          }
          className="w-[112px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[10px] text-[#aeb3bc] outline-none hover:border-white/[0.08] hover:bg-white/[0.03] disabled:opacity-70"
        >
          {editableWorkflowStateOptions(task, workflowStates).map((state) => (
            <option key={state.id} value={state.id}>
              {workflowStateLabel(t, state)}
            </option>
          ))}
        </select>
      );
    case "priority":
      return (
        <select
          value={task.priority}
          disabled={!canManage || immutable}
          onChange={(event) =>
            onQuickUpdate(task, { priority: event.target.value as CrewTaskPriority })
          }
          className="w-[104px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[10px] text-[#aeb3bc] outline-none hover:border-white/[0.08] hover:bg-white/[0.03] disabled:opacity-70"
        >
          {(["urgent", "high", "normal", "low"] as const).map((priority) => (
            <option key={priority} value={priority}>
              {t(`priority.${priority}`)}
            </option>
          ))}
        </select>
      );
    case "assignees":
      return <AssigneeStack task={task} displays={displays} />;
    case "estimate":
      return <TableValue mono>{task.estimatePoints ?? "—"}</TableValue>;
    case "cycle":
      return (
        <select
          value={task.cycleId ?? ""}
          disabled={!canManage || immutable}
          onChange={(event) => onQuickUpdate(task, { cycleId: event.target.value || null })}
          className="w-[116px] truncate rounded-md border border-transparent bg-transparent px-1.5 py-1.5 text-[10px] text-[#8e949f] outline-none hover:border-white/[0.08] hover:bg-white/[0.03] disabled:opacity-70"
        >
          <option value="">{t("backlog")}</option>
          {cycles
            .filter((cycle) => cycle.status !== "cancelled")
            .map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.name}
              </option>
            ))}
        </select>
      );
    case "labels":
      return (
        <div className="flex min-w-0 gap-1 overflow-hidden pr-3">
          {task.labels.length ? (
            task.labels.slice(0, 2).map((label) => (
              <span
                key={label.id}
                className="max-w-20 truncate rounded px-1.5 py-0.5 text-[8px]"
                style={{ color: label.color, backgroundColor: `${label.color}18` }}
              >
                {label.name}
              </span>
            ))
          ) : (
            <span className="text-[#555c66]">—</span>
          )}
        </div>
      );
    case "points":
      return (
        <TableValue mono>
          {task.computeBudgetPoints == null
            ? task.computeUsedPoints
            : `${task.computeUsedPoints}/${task.computeBudgetPoints}`}
        </TableValue>
      );
    case "startAt":
      return <TableValue>{task.startAt ? shortDate(task.startAt) : "—"}</TableValue>;
    case "dueAt":
      return (
        <TableValue className={cn(isOverdue(task) && "font-medium text-red-300")}>
          {task.dueAt ? shortDate(task.dueAt) : "—"}
        </TableValue>
      );
    case "updatedAt":
      return <TableValue>{shortDate(task.updatedAt)}</TableValue>;
    case "parent":
      return task.parent ? (
        <button
          type="button"
          onClick={() => onOpenTask(task.parent!.id)}
          className="truncate pr-3 text-left font-mono text-[9px] text-[#8e949f] hover:text-white"
          title={task.parent.title}
        >
          #{task.parent.number} {task.parent.title}
        </button>
      ) : (
        <TableValue>—</TableValue>
      );
    case "subtasks":
      return (
        <TableValue>
          {task.subtaskProgress.total
            ? `${task.subtaskProgress.completed}/${task.subtaskProgress.total}`
            : "—"}
        </TableValue>
      );
    case "blockedBy": {
      const unresolved = task.blockedBy.filter((blocker) => !blocker.resolved);
      return unresolved.length ? (
        <button
          type="button"
          onClick={() => onOpenTask(unresolved[0]!.id)}
          className="truncate pr-3 text-left text-[9px] text-amber-300 hover:text-amber-200"
          title={unresolved.map((blocker) => `#${blocker.number} ${blocker.title}`).join("\n")}
        >
          {t("blocked")} · {unresolved.length}
        </button>
      ) : (
        <TableValue>—</TableValue>
      );
    }
    default:
      return <CustomTableValue task={task} field={field} displays={displays} />;
  }
}

function CustomTableValue({
  task,
  field,
  displays,
}: {
  task: CrewTaskListItemDTO;
  field?: CrewTaskFieldDTO;
  displays: Displays;
}) {
  if (!field) return <TableValue>—</TableValue>;
  const label = formatCustomFieldValue(task, field, displays);
  if (!label) return <TableValue>—</TableValue>;

  return (
    <span className="truncate pr-3 text-[10px] text-[#8e949f]" title={label}>
      {label}
    </span>
  );
}

function TableValue({
  children,
  mono = false,
  className,
}: {
  children: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "truncate pr-3 text-[10px] text-[#747b86]",
        mono && "font-mono text-[#8e949f]",
        className
      )}
    >
      {children}
    </span>
  );
}

function BoardView(props: TaskProjectViewProps) {
  const {
    tasks,
    canManage,
    onMoveTask,
    onCreateWorkflowState,
    onEditWorkflowState,
    view,
    workflowStates,
  } = props;
  const t = useTranslations("crewTaskProject");
  const boardStates = useMemo(
    () =>
      workflowStates.filter(
        (state) =>
          !state.archived &&
          workflowStateMatchesScope(state, view.scope) &&
          (!view.filters.workflowStateIds?.length ||
            view.filters.workflowStateIds.includes(state.id))
      ),
    [view.filters.workflowStateIds, view.scope, workflowStates]
  );
  const stateById = useMemo(
    () => new Map(boardStates.map((state) => [state.id, state])),
    [boardStates]
  );
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const sourceOrder = useMemo(
    () =>
      createBoardOrder(
        tasks,
        boardStates.map((state) => state.id)
      ),
    [boardStates, tasks]
  );
  const [projectedOrder, setProjectedOrder] = useState<typeof sourceOrder | null>(null);
  const [isPersisting, setIsPersisting] = useState(false);
  const boardOrder = projectedOrder ?? sourceOrder;
  const boardOrderRef = useRef(boardOrder);
  const dragStartOrderRef = useRef(boardOrder);
  const manualOrdering =
    view.sorts.length === 0 ||
    (view.sorts[0]?.field === "rank" && view.sorts[0]?.direction === "asc");
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const commitBoardOrder = useCallback((next: typeof boardOrder) => {
    boardOrderRef.current = next;
    setProjectedOrder(next);
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (event.active.id == null) return;
      boardOrderRef.current = boardOrder;
      dragStartOrderRef.current = boardOrder;
    },
    [boardOrder]
  );

  const projectDragOrder = useCallback(
    (
      event: Pick<DragOverEvent, "active" | "over" | "activatorEvent" | "delta">,
      current: typeof boardOrder
    ) => {
      const sourceId = String(event.active.id);
      const target = event.over;
      if (!target) return null;

      const targetData = target.data.current;
      const workflowStateId = targetData?.workflowStateId;
      const targetState =
        typeof workflowStateId === "string" ? stateById.get(workflowStateId) : undefined;
      if (
        (targetData?.kind !== "column" && targetData?.kind !== "task") ||
        !targetState ||
        !isManuallyMovableWorkflowState(targetState)
      ) {
        return null;
      }

      const targetIds = (current[targetState.id] ?? []).filter((taskId) => taskId !== sourceId);
      let targetIndex = targetIds.length;
      if (targetData.kind === "task") {
        const targetId = String(target.id);
        if (targetId === sourceId) return current;
        const overIndex = targetIds.indexOf(targetId);
        if (overIndex < 0) return null;

        const translated = event.active.rect.current.translated;
        const keyboardDirection =
          event.activatorEvent instanceof KeyboardEvent ? Math.sign(event.delta.y) : 0;
        const isAfterTarget =
          keyboardDirection > 0 ||
          (keyboardDirection === 0 &&
            translated != null &&
            translated.top > target.rect.top + target.rect.height / 2);
        targetIndex = overIndex + (isAfterTarget ? 1 : 0);
      }

      return moveBoardTask(current, sourceId, targetState.id, targetIndex);
    },
    [stateById]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const current = boardOrderRef.current;
      const next = projectDragOrder(event, current);
      if (next && !boardOrdersEqual(current, next)) commitBoardOrder(next);
    },
    [commitBoardOrder, projectDragOrder]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const sourceId = String(event.active.id);
      const startOrder = dragStartOrderRef.current;

      if (!event.over) {
        boardOrderRef.current = startOrder;
        setProjectedOrder(null);
        return;
      }

      const current = boardOrderRef.current;
      const finalOrder = projectDragOrder(event, current);
      if (!finalOrder) {
        boardOrderRef.current = startOrder;
        setProjectedOrder(null);
        return;
      }

      commitBoardOrder(finalOrder);
      if (boardOrdersEqual(startOrder, finalOrder)) {
        setProjectedOrder(null);
        return;
      }

      const placement = placementForTask(finalOrder, sourceId);
      const task = taskById.get(sourceId);
      const destinationState = placement ? stateById.get(placement.workflowStateId) : null;
      if (!placement || !task || !destinationState) {
        setProjectedOrder(null);
        return;
      }

      setIsPersisting(true);
      try {
        await onMoveTask(task, destinationState, placement.beforeTaskId, placement.afterTaskId);
      } catch {
        setProjectedOrder(null);
      } finally {
        setIsPersisting(false);
        setProjectedOrder(null);
      }
    },
    [commitBoardOrder, onMoveTask, projectDragOrder, stateById, taskById]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        boardOrderRef.current = dragStartOrderRef.current;
        setProjectedOrder(null);
      }}
    >
      <div className="relative">
        {!manualOrdering ? (
          <div className="mx-4 mt-4 rounded-lg border border-amber-400/15 bg-amber-400/[0.045] px-3 py-2 text-[9px] text-amber-200/75">
            {t("manualOrderingRequired")}
          </div>
        ) : null}
        {isPersisting ? (
          <div
            className="pointer-events-none absolute right-5 top-5 z-20 inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-[#111319]/95 px-2.5 py-1 text-[9px] text-[#aeb3bc] shadow-lg backdrop-blur"
            role="status"
          >
            <IconLoader2 className="size-3 animate-spin" />
            {t("savingOrder")}
          </div>
        ) : null}
        <div className="flex min-w-max items-start gap-3 p-4">
          {boardStates.map((state) => (
            <BoardColumn
              key={state.id}
              state={state}
              items={(boardOrder[state.id] ?? [])
                .map((taskId) => taskById.get(taskId))
                .filter((task): task is CrewTaskListItemDTO => task != null)}
              boardProps={props}
              canDrag={canManage && manualOrdering && !isPersisting}
              onEdit={() => onEditWorkflowState(state)}
            />
          ))}
          {canManage ? (
            <button
              type="button"
              onClick={() => onCreateWorkflowState(boardStates.at(-1)?.id ?? null)}
              className="grid h-11 w-12 shrink-0 place-items-center rounded-xl border border-dashed border-white/[0.1] bg-white/[0.018] text-[#656c77] transition-colors hover:border-white/[0.18] hover:bg-white/[0.045] hover:text-white"
              aria-label={t("addWorkflowColumn")}
              title={t("addWorkflowColumn")}
            >
              <IconPlus className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
    </DndContext>
  );
}

function BoardColumn({
  state,
  items,
  boardProps,
  canDrag,
  onEdit,
}: {
  state: CrewTaskWorkflowStateDTO;
  items: CrewTaskListItemDTO[];
  boardProps: TaskProjectViewProps;
  canDrag: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations("crewTaskProject");
  const { setNodeRef, isOver } = useDroppable({
    id: `crew-task-column:${state.id}`,
    disabled: !canDrag || !isManuallyMovableWorkflowState(state),
    data: { kind: "column", workflowStateId: state.id },
  });

  return (
    <section
      className={cn(
        "flex min-h-[520px] w-[270px] shrink-0 flex-col rounded-xl border border-white/[0.065] bg-[#0a0b0e] transition-colors",
        isOver && "border-red-400/25 bg-red-500/[0.025]"
      )}
    >
      <header className="flex h-11 items-center gap-2 border-b border-white/[0.06] px-3">
        <span className="size-2 rounded-full" style={{ backgroundColor: state.color }} />
        <span className="min-w-0 truncate text-[10px] font-semibold text-[#b6bac2]">
          {workflowStateLabel(t, state)}
        </span>
        <span className="rounded bg-white/[0.055] px-1.5 py-0.5 text-[9px] text-[#676d77]">
          {items.length}
          {boardProps.workflowCounts?.[state.id] != null &&
          boardProps.workflowCounts[state.id] !== items.length
            ? ` / ${boardProps.workflowCounts[state.id]}`
            : ""}
        </span>
        <span className="ml-auto" />
        {!isManuallyMovableWorkflowState(state) ? (
          <span className="text-[8px] text-[#595f69]">{t("workflowOnly")}</span>
        ) : null}
        {boardProps.canManage ? (
          <button
            type="button"
            onClick={onEdit}
            className="grid size-6 place-items-center rounded-md text-[#555c67] hover:bg-white/[0.055] hover:text-[#c2c6ce]"
            aria-label={t("editWorkflowColumn", { name: workflowStateLabel(t, state) })}
          >
            <IconDots className="size-3.5" />
          </button>
        ) : null}
      </header>
      <div ref={setNodeRef} className="min-h-24 flex-1 space-y-2 p-2.5">
        <SortableContext
          items={items.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((task) => (
            <BoardCard
              key={task.id}
              task={task}
              {...boardProps}
              boardStateId={state.id}
              draggable={canDrag && isManuallyMovableWorkflowState(state)}
            />
          ))}
        </SortableContext>
        {items.length === 0 ? (
          <div
            className={cn(
              "grid min-h-24 place-items-center rounded-lg border border-dashed border-white/[0.065] text-[10px] text-[#555b65] transition-colors",
              isOver && "border-red-400/25 bg-red-500/[0.035] text-red-200/70"
            )}
          >
            {t("emptyColumn")}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function BoardCard({
  task,
  view,
  fields,
  displays,
  selectedIds,
  onToggleSelected,
  onOpenTask,
  boardStateId,
  draggable,
}: TaskProjectViewProps & {
  task: CrewTaskListItemDTO;
  boardStateId: string;
  draggable: boolean;
}) {
  const t = useTranslations("crewTaskProject");
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: task.id,
    data: { kind: "task", workflowStateId: boardStateId },
    disabled: !draggable,
    transition: { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
  });
  const visibleFields = new Set(
    view.visibleFields.length
      ? view.visibleFields
      : ["priority", "assignees", "labels", "estimate", "dueAt"]
  );
  const customProperties = fields
    .filter((field) => visibleFields.has(`custom:${field.id}`))
    .map((field) => ({ field, value: formatCustomFieldValue(task, field, displays) }))
    .filter(
      (property): property is { field: CrewTaskFieldDTO; value: string } => property.value != null
    );
  const unresolvedBlockers = task.blockedBy.filter((blocker) => !blocker.resolved);
  const onCardPointerDown = listeners?.onPointerDown as
    | React.PointerEventHandler<HTMLElement>
    | undefined;
  const onHandleKeyDown = listeners?.onKeyDown as
    | React.KeyboardEventHandler<HTMLButtonElement>
    | undefined;
  return (
    <article
      ref={setNodeRef}
      onPointerDown={onCardPointerDown}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "group rounded-lg border border-white/[0.075] bg-[#0e1014] p-3 shadow-[0_5px_18px_rgba(0,0,0,.16)] transition-[border-color,background-color,box-shadow,opacity] hover:border-white/[0.13] hover:bg-[#111318]",
        draggable && "cursor-grab active:cursor-grabbing",
        isDragging && "z-20 border-red-400/30 bg-[#151217] opacity-90 shadow-2xl",
        isOver && "border-red-400/20",
        selectedIds.has(task.id) && "border-red-500/30 bg-red-500/[0.035]"
      )}
    >
      <div className="flex items-start gap-2">
        {draggable ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            onKeyDown={onHandleKeyDown}
            className="mt-0.5 shrink-0 touch-none cursor-grab rounded p-0.5 text-[#4e545f] opacity-0 outline-none transition-[color,opacity,background-color] hover:bg-white/[0.055] hover:text-[#a7adb7] focus-visible:bg-white/[0.07] focus-visible:text-white focus-visible:opacity-100 active:cursor-grabbing group-hover:opacity-100"
            aria-label={t("dragTask", { number: task.number })}
            title={t("dragTask", { number: task.number })}
          >
            <IconGripVertical className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onOpenTask(task.id)}
          className="min-w-0 flex-1 cursor-inherit text-left"
        >
          <span className="block text-[9px] font-mono text-[#59606b]">#{task.number}</span>
          <span className="mt-1 block line-clamp-2 text-[11px] font-medium leading-5 text-[#daddE2]">
            {task.title}
          </span>
        </button>
        <input
          type="checkbox"
          onPointerDown={(event) => event.stopPropagation()}
          checked={selectedIds.has(task.id)}
          onChange={() => onToggleSelected(task.id)}
          className="size-3.5 rounded border-white/15 bg-transparent accent-[#e12b32] opacity-0 group-hover:opacity-100 checked:opacity-100"
          aria-label={t("selectTask", { number: task.number })}
        />
      </div>
      {visibleFields.has("labels") && task.labels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className="rounded px-1.5 py-0.5 text-[8px]"
              style={{ color: label.color, backgroundColor: `${label.color}18` }}
            >
              {label.name}
            </span>
          ))}
        </div>
      ) : null}
      {(visibleFields.has("parent") && task.parent) ||
      (visibleFields.has("subtasks") && task.subtaskProgress.total > 0) ||
      unresolvedBlockers.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[8px] text-[#646b76]">
          {visibleFields.has("parent") && task.parent ? (
            <span className="font-mono">↳ #{task.parent.number}</span>
          ) : null}
          {visibleFields.has("subtasks") && task.subtaskProgress.total > 0 ? (
            <span>
              {t("subtaskProgress", {
                completed: task.subtaskProgress.completed,
                total: task.subtaskProgress.total,
              })}
            </span>
          ) : null}
          {unresolvedBlockers.length > 0 ? (
            <span className="text-amber-300">
              {t("blocked")} · {unresolvedBlockers.length}
            </span>
          ) : null}
        </div>
      ) : null}
      {customProperties.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {customProperties.map(({ field, value }) => (
            <span
              key={field.id}
              className="max-w-full truncate rounded border border-white/[0.055] bg-white/[0.025] px-1.5 py-0.5 text-[8px] text-[#858b95]"
              title={`${field.name}: ${value}`}
            >
              <span className="text-[#555c66]">{field.name}</span> · {value}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex min-h-5 items-center gap-2 text-[9px] text-[#69707b]">
        {visibleFields.has("priority") ? <PriorityMark priority={task.priority} /> : null}
        {visibleFields.has("estimate") && task.estimatePoints != null ? (
          <span className="rounded bg-white/[0.055] px-1.5 py-0.5 font-mono">
            {task.estimatePoints}
          </span>
        ) : null}
        {visibleFields.has("points") ? (
          <span className="rounded bg-white/[0.055] px-1.5 py-0.5 font-mono">
            {task.computeBudgetPoints == null
              ? task.computeUsedPoints
              : `${task.computeUsedPoints}/${task.computeBudgetPoints}`}
          </span>
        ) : null}
        {visibleFields.has("cycle") && task.cycle ? (
          <span className="max-w-20 truncate" title={task.cycle.name}>
            {task.cycle.name}
          </span>
        ) : null}
        {visibleFields.has("dueAt") && task.dueAt ? (
          <span className={cn("inline-flex items-center gap-1", isOverdue(task) && "text-red-300")}>
            <IconCalendar className="size-3" />
            {shortDate(task.dueAt)}
          </span>
        ) : null}
        {visibleFields.has("assignees") ? (
          <div className="ml-auto">
            <AssigneeStack task={task} displays={displays} compact />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function CalendarView(props: TaskProjectViewProps) {
  const { tasks, onOpenTask } = props;
  const t = useTranslations("crewTaskProject");
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const days = calendarDays(cursor);
  const scheduled = tasks.filter((task) => task.dueAt);
  const unscheduled = tasks.filter((task) => !task.dueAt);

  return (
    <div className="min-w-[900px] p-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCursor(startOfMonth(new Date()))}
          className="rounded-md border border-white/[0.08] px-2.5 py-1.5 text-[10px] text-[#aeb3bb] hover:bg-white/[0.04]"
        >
          {t("today")}
        </button>
        <button
          type="button"
          onClick={() => setCursor(addMonths(cursor, -1))}
          className="rounded p-1.5 text-[#737985] hover:bg-white/[0.04]"
          aria-label={t("previousMonth")}
        >
          <IconChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setCursor(addMonths(cursor, 1))}
          className="rounded p-1.5 text-[#737985] hover:bg-white/[0.04]"
          aria-label={t("nextMonth")}
        >
          <IconChevronRight className="size-4" />
        </button>
        <h3 className="ml-2 text-[13px] font-semibold text-[#e1e3e7]">
          {cursor.toLocaleDateString(undefined, { year: "numeric", month: "long" })}
        </h3>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-white/[0.075] bg-[#090a0d]">
        {days.slice(0, 7).map((day) => (
          <div
            key={`header-${day.getDay()}`}
            className="border-b border-r border-white/[0.06] px-2 py-2 text-[9px] font-semibold uppercase text-[#626873] last:border-r-0"
          >
            {day.toLocaleDateString(undefined, { weekday: "short" })}
          </div>
        ))}
        {days.map((day, index) => {
          const dayTasks = scheduled.filter((task) => sameDay(new Date(task.dueAt!), day));
          const currentMonth = day.getMonth() === cursor.getMonth();
          const today = sameDay(day, new Date());
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "min-h-28 border-b border-r border-white/[0.052] p-1.5",
                index % 7 === 6 && "border-r-0",
                !currentMonth && "bg-white/[0.012]"
              )}
            >
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full text-[9px]",
                  currentMonth ? "text-[#858b95]" : "text-[#454b55]",
                  today && "bg-[#e12b32] font-semibold text-white"
                )}
              >
                {day.getDate()}
              </span>
              <div className="mt-1 space-y-1">
                {dayTasks.slice(0, 4).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onOpenTask(task.id)}
                    className="flex w-full items-center gap-1.5 rounded border border-white/[0.055] bg-white/[0.03] px-1.5 py-1 text-left text-[9px] text-[#c5c9d0] hover:border-white/[0.11] hover:bg-white/[0.05]"
                  >
                    <PriorityMark priority={task.priority} />
                    <span className="truncate">{task.title}</span>
                  </button>
                ))}
                {dayTasks.length > 4 ? (
                  <span className="block px-1 text-[8px] text-[#5f6570]">
                    {t("moreCount", { count: dayTasks.length - 4 })}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {unscheduled.length > 0 ? <Unscheduled tasks={unscheduled} onOpenTask={onOpenTask} /> : null}
    </div>
  );
}

function TimelineView({ tasks, cycles, onOpenTask }: TaskProjectViewProps) {
  const t = useTranslations("crewTaskProject");
  const dated = tasks.filter((task) => task.startAt || task.dueAt);
  const undated = tasks.filter((task) => !task.startAt && !task.dueAt);
  const range = timelineRange(dated);
  const weeks = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(range.start);
    date.setDate(date.getDate() + index * 7);
    return date;
  });

  return (
    <div className="min-w-[1040px] p-4">
      <div className="overflow-hidden rounded-xl border border-white/[0.075] bg-[#090a0d]">
        <div className="grid grid-cols-[260px_1fr] border-b border-white/[0.07] bg-[#0b0c0f]">
          <div className="border-r border-white/[0.065] px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#646a74]">
            {t("roadmap")}
          </div>
          <div className="grid grid-cols-12">
            {weeks.map((week) => (
              <div
                key={week.toISOString()}
                className="border-r border-white/[0.05] px-1.5 py-2 text-[8px] text-[#626873] last:border-r-0"
              >
                {week.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
            ))}
          </div>
        </div>
        {dated.map((task) => {
          const start = new Date(task.startAt ?? task.dueAt!);
          const end = new Date(task.dueAt ?? task.startAt!);
          const left = clampPercent(
            ((start.getTime() - range.start.getTime()) / range.duration) * 100
          );
          const right = clampPercent(
            ((end.getTime() - range.start.getTime()) / range.duration) * 100
          );
          const width = Math.max(2.5, right - left + 1.2);
          return (
            <div
              key={task.id}
              className="grid min-h-11 grid-cols-[260px_1fr] border-b border-white/[0.052] last:border-b-0"
            >
              <button
                type="button"
                onClick={() => onOpenTask(task.id)}
                className="flex min-w-0 items-center gap-2 border-r border-white/[0.065] px-3 text-left hover:bg-white/[0.025]"
              >
                <span className="font-mono text-[9px] text-[#555c67]">#{task.number}</span>
                <span className="truncate text-[10px] text-[#c8ccd2]">{task.title}</span>
              </button>
              <div className="relative grid grid-cols-12">
                {weeks.map((week) => (
                  <span
                    key={week.toISOString()}
                    className="border-r border-white/[0.04] last:border-r-0"
                  />
                ))}
                <button
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="absolute top-2 h-7 min-w-8 overflow-hidden rounded-md border border-red-400/20 bg-red-500/15 px-2 text-left text-[9px] text-red-100 transition-colors hover:bg-red-500/25"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${task.title} · ${shortDate(start.toISOString())} – ${shortDate(end.toISOString())}`}
                >
                  <span className="block truncate">{task.title}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {cycles.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {cycles
            .filter((cycle) => cycle.status !== "cancelled")
            .map((cycle) => (
              <span
                key={cycle.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1 text-[9px] text-[#838a95]"
              >
                <IconClock className="size-3" />
                {cycle.name}
                <span className="text-[#555c66]">
                  {shortDate(cycle.startAt)}–{shortDate(cycle.endAt)}
                </span>
              </span>
            ))}
        </div>
      ) : null}
      {undated.length > 0 ? <Unscheduled tasks={undated} onOpenTask={onOpenTask} /> : null}
    </div>
  );
}

function Unscheduled({
  tasks,
  onOpenTask,
}: {
  tasks: CrewTaskListItemDTO[];
  onOpenTask: (taskId: string) => void;
}) {
  const t = useTranslations("crewTaskProject");
  return (
    <div className="mt-3 rounded-xl border border-white/[0.07] bg-[#0a0b0e] p-3">
      <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#666c76]">
        <IconCalendar className="size-3.5" />
        {t("unscheduled")}
        <span>{tasks.length}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onOpenTask(task.id)}
            className="rounded-md border border-white/[0.065] bg-white/[0.025] px-2.5 py-1.5 text-[9px] text-[#aeb3bc] hover:bg-white/[0.05]"
          >
            #{task.number} {task.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function AssigneeStack({
  task,
  displays,
  compact = false,
}: {
  task: CrewTaskListItemDTO;
  displays: Displays;
  compact?: boolean;
}) {
  if (task.assignees.length === 0) {
    return compact ? null : <span className="text-[10px] text-[#555c66]">—</span>;
  }
  return (
    <div className="flex items-center">
      {task.assignees.slice(0, compact ? 2 : 3).map((assignee, index) => {
        const name = displayNameOf(assignee.userId, displays);
        return (
          <span
            key={assignee.id}
            title={name}
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-full border border-[#111318] bg-[#252932] text-[7px] font-semibold text-[#c9cdd4]",
              index > 0 && "-ml-1.5"
            )}
          >
            {initials(name)}
          </span>
        );
      })}
      {task.assignees.length > (compact ? 2 : 3) ? (
        <span className="-ml-1.5 grid size-5 place-items-center rounded-full border border-[#111318] bg-[#1b1e25] text-[7px] text-[#8b919b]">
          +{task.assignees.length - (compact ? 2 : 3)}
        </span>
      ) : null}
    </div>
  );
}

function formatCustomFieldValue(
  task: CrewTaskListItemDTO,
  field: CrewTaskFieldDTO,
  displays: Displays
): string | null {
  const value = task.customFieldValues.find((candidate) => candidate.fieldId === field.id)?.value;
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  if (field.type === "checkbox") return value === true ? "✓" : null;
  if (field.type === "date" && typeof value === "string") return shortDate(value);
  if (field.type === "user" && typeof value === "string") return displayNameOf(value, displays);
  if (field.type === "single_select" && typeof value === "string") {
    return field.options.find((option) => option.id === value)?.label ?? value;
  }
  if (field.type === "multi_select" && Array.isArray(value)) {
    return value
      .map((optionId) => field.options.find((option) => option.id === optionId)?.label ?? optionId)
      .join(", ");
  }
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function PriorityMark({ priority }: { priority: CrewTaskPriority }) {
  return (
    <span
      className={cn(
        "inline-flex size-2 shrink-0 rounded-full",
        priority === "urgent" && "bg-red-400",
        priority === "high" && "bg-orange-300",
        priority === "normal" && "bg-sky-400",
        priority === "low" && "bg-[#68707c]"
      )}
    />
  );
}

function editableWorkflowStateOptions(
  task: CrewTaskListItemDTO,
  states: CrewTaskWorkflowStateDTO[]
): CrewTaskWorkflowStateDTO[] {
  if (task.status === "submitted" || task.status === "approved") {
    return [task.workflowState];
  }
  return states.filter(
    (state) =>
      state.id === task.workflowStateId ||
      (!state.archived && (isManuallyMovableWorkflowState(state) || state.semantic === "cancelled"))
  );
}

function isManuallyMovableWorkflowState(state: CrewTaskWorkflowStateDTO) {
  return (
    state.semantic === "open" ||
    state.semantic === "in_progress" ||
    state.semantic === "revision_requested"
  );
}

function workflowStateMatchesScope(
  state: CrewTaskWorkflowStateDTO,
  scope: CrewTaskViewDTO["scope"]
) {
  switch (scope) {
    case "backlog":
      return state.semantic === "open";
    case "active":
      return state.semantic !== "approved" && state.semantic !== "cancelled";
    case "review":
      return state.semantic === "submitted";
    case "completed":
      return state.semantic === "approved" || state.semantic === "cancelled";
    default:
      return true;
  }
}

function workflowStateLabel(
  t: ReturnType<typeof useTranslations>,
  state: CrewTaskWorkflowStateDTO
) {
  return state.systemKey ? t(`status.${state.systemKey}`) : state.name;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isOverdue(task: CrewTaskListItemDTO) {
  return (
    task.dueAt != null &&
    new Date(task.dueAt).getTime() < Date.now() &&
    task.status !== "approved" &&
    task.status !== "cancelled"
  );
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function calendarDays(month: Date) {
  const first = startOfMonth(month);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function timelineRange(tasks: CrewTaskListItemDTO[]) {
  const dates = tasks.flatMap((task) =>
    [task.startAt, task.dueAt].filter((value): value is string => value != null)
  );
  const earliest = dates.length
    ? new Date(Math.min(...dates.map((value) => new Date(value).getTime())))
    : new Date();
  const start = new Date(earliest);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  const duration = 12 * 7 * 24 * 60 * 60 * 1000;
  return { start, duration };
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(99, value));
}
