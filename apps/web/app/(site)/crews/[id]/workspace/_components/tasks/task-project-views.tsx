"use client";

import { workflowStateLabel } from "@/app/(site)/crews/_lib/workflow-state-label";

import { TaskUnreadMarker } from "@/app/(site)/crews/_components/task-unread-marker";

import { TaskDeadline } from "@/app/(site)/crews/_components/task-deadline";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  IconAntennaBars1,
  IconAntennaBars5,
  IconCheck,
  IconChevronDown,
  IconCircle,
  IconCircleCheckFilled,
  IconCircleDashed,
  IconCircleDot,
  IconCircleXFilled,
  IconDots,
  IconPlus,
  IconSubtask,
  IconUrgent,
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
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LookupUserDTO } from "@repo/shared/users";

import type {
  CrewTaskCycleDTO,
  CrewTaskFieldDTO,
  CrewTaskListItemDTO,
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
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";

type Displays = Map<string, LookupUserDTO>;

export interface TaskProjectViewProps {
  tasks: CrewTaskListItemDTO[];
  workflowCounts?: Record<string, number>;
  view: CrewTaskViewDTO;
  cycles: CrewTaskCycleDTO[];
  fields: CrewTaskFieldDTO[];
  workflowStates: CrewTaskWorkflowStateDTO[];
  displays: Displays;
  selectedIds: Set<string>;
  canManage: boolean;
  canCreate?: boolean;
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
  onCreateTask: (workflowStateId: string | null) => void;
}

export function TaskProjectView(props: TaskProjectViewProps) {
  return props.view.layout === "board" ? <BoardView {...props} /> : <ListView {...props} />;
}

function ListView(props: TaskProjectViewProps) {
  const t = useTranslations("crewTaskProject");
  const { tasks, view, selectedIds, onToggleAll } = props;
  const groups = useMemo(() => resolveListGroups(props, t), [props, t]);
  const allIds = tasks.map((task) => task.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

  return (
    <div className="min-w-[760px] pb-10">
      {selectedIds.size > 0 ? (
        <div className="sticky top-0 z-20 flex h-10 items-center gap-3 border-b border-white/[0.08] bg-[#111216]/95 px-4 text-[11px] text-[#b9bdc5] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => onToggleAll(allIds)}
            className="grid size-4 place-items-center rounded border border-white/20 bg-[#e52227] text-white"
            aria-label={allSelected ? t("clearSelection") : t("selectAll")}
          >
            <IconCheck className="size-3" stroke={2.5} />
          </button>
          <span>{selectedIds.size}</span>
        </div>
      ) : null}

      {groups.map((group) => (
        <ListGroup key={group.key} group={group} props={props} />
      ))}

      {groups.length === 0 ? (
        <EmptyIssues onCreate={props.canCreate ? () => props.onCreateTask(null) : undefined} />
      ) : null}
      {props.canCreate && view.groupBy == null && tasks.length > 0 ? (
        <button
          type="button"
          onClick={() => props.onCreateTask(null)}
          className="flex h-10 w-full items-center gap-2 border-b border-white/[0.05] px-5 text-[11px] text-[#5f6570] hover:bg-white/[0.025] hover:text-[#aeb3bc]"
        >
          <IconPlus className="size-3.5" />
          {t("addIssue")}
        </button>
      ) : null}
    </div>
  );
}

interface ListGroupValue {
  key: string;
  label: string | null;
  color?: string;
  state?: CrewTaskWorkflowStateDTO;
  tasks: CrewTaskListItemDTO[];
}

function ListGroup({ group, props }: { group: ListGroupValue; props: TaskProjectViewProps }) {
  const t = useTranslations("crewTaskProject");
  const [collapsed, setCollapsed] = useState(false);
  const grouped = props.view.groupBy != null;

  return (
    <section>
      {grouped ? (
        <div className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-white/[0.055] bg-[#111216] px-4">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="grid size-5 place-items-center text-[#5f6570] hover:text-[#d3d5da]"
            aria-label={collapsed ? t("expandGroup") : t("collapseGroup")}
          >
            <IconChevronDown
              className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")}
            />
          </button>
          <StatusMark state={group.state} color={group.color} />
          <span className="text-[11px] font-medium text-[#c8cbd1]">{group.label}</span>
          <span className="text-[10px] tabular-nums text-[#666d77]">{group.tasks.length}</span>
          {props.canCreate ? (
            <button
              type="button"
              className="ml-auto grid size-6 place-items-center rounded text-[#666d77] hover:bg-white/[0.05] hover:text-white"
              onClick={() => props.onCreateTask(group.state?.id ?? null)}
              aria-label={t("addIssue")}
            >
              <IconPlus className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      {!collapsed
        ? group.tasks.map((task) => <IssueRow key={task.id} task={task} props={props} />)
        : null}
      {!collapsed && grouped && props.canCreate ? (
        <button
          type="button"
          onClick={() => props.onCreateTask(group.state?.id ?? null)}
          className="flex h-9 w-full items-center gap-2 border-b border-white/[0.05] px-11 text-[10px] text-[#555c67] hover:bg-white/[0.025] hover:text-[#9da2ac]"
        >
          <IconPlus className="size-3.5" />
          {t("addIssue")}
        </button>
      ) : null}
    </section>
  );
}

function IssueRow({ task, props }: { task: CrewTaskListItemDTO; props: TaskProjectViewProps }) {
  const t = useTranslations("crewTaskProject");
  const displayProperties = new Set(props.view.visibleFields);
  const selected = props.selectedIds.has(task.id);

  return (
    <div
      className={cn(
        "group grid min-h-10 grid-cols-[32px_20px_68px_minmax(260px,1fr)_auto] items-center border-b border-white/[0.05] px-3 transition-colors hover:bg-white/[0.028]",
        selected && "bg-[#e52227]/[0.045]"
      )}
    >
      <label className="grid size-7 cursor-pointer place-items-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => props.onToggleSelected(task.id)}
          className="size-3.5 rounded border-white/20 bg-transparent accent-[#e52227] opacity-0 transition-opacity group-hover:opacity-100 checked:opacity-100"
          aria-label={t("selectTask", { number: task.number })}
        />
      </label>
      <StatusMark state={task.workflowState} />
      <span className="font-mono text-[10px] text-[#666d77]">TASK-{task.number}</span>
      <button
        type="button"
        onClick={() => props.onOpenTask(task.id)}
        className="flex min-w-0 items-center pr-4 text-left text-[11px] font-medium text-[#d9dce1]"
      >
        <span className="truncate">{task.title}</span>
        <TaskUnreadMarker taskId={task.id} />
      </button>
      <div className="flex items-center gap-3 pr-2 text-[10px] text-[#656c77]">
        {displayProperties.has("subtasks") && task.subtaskProgress.total > 0 ? (
          <span className="inline-flex items-center gap-1">
            <IconSubtask className="size-3.5" />
            {task.subtaskProgress.completed}/{task.subtaskProgress.total}
          </span>
        ) : null}
        {displayProperties.has("labels")
          ? task.labels.slice(0, 2).map((label) => (
              <span
                key={label.id}
                className="rounded-full border px-2 py-0.5 text-[9px]"
                style={{ borderColor: `${label.color}55`, color: label.color }}
              >
                {label.name}
              </span>
            ))
          : null}
        {displayProperties.has("priority") ? <PriorityMark priority={task.priority} /> : null}
        {displayProperties.has("cycle") && task.cycle ? (
          <span className="max-w-40 truncate" title={`${t("filterCycle")}: ${task.cycle.name}`}>
            {task.cycle.name}
          </span>
        ) : null}
        {displayProperties.has("dueAt") && task.dueAt ? (
          <TaskDeadline dueAt={task.dueAt} status={task.status} />
        ) : null}
        {displayProperties.has("assignees") ? (
          <TaskAssignees task={task} displays={props.displays} />
        ) : null}
      </div>
    </div>
  );
}

function BoardView(props: TaskProjectViewProps) {
  const t = useTranslations("crewTaskProject");
  const { tasks, workflowStates, view } = props;
  const states = useMemo(() => {
    const filtered = workflowStates.filter(
      (state) =>
        !state.archived &&
        (!view.filters.workflowStateIds?.length || view.filters.workflowStateIds.includes(state.id))
    );
    return view.showEmptyGroups
      ? filtered
      : filtered.filter(
          (state) =>
            isCoreBoardColumn(state) || tasks.some((task) => task.workflowStateId === state.id)
        );
  }, [tasks, view.filters.workflowStateIds, view.showEmptyGroups, workflowStates]);
  const stateById = useMemo(() => new Map(states.map((state) => [state.id, state])), [states]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const sourceOrder = useMemo(
    () =>
      createBoardOrder(
        tasks,
        states.map((state) => state.id)
      ),
    [states, tasks]
  );
  const [projectedOrder, setProjectedOrder] = useState<typeof sourceOrder | null>(null);
  const boardOrder = projectedOrder ?? sourceOrder;
  const boardOrderRef = useRef(boardOrder);
  const dragStartOrderRef = useRef(boardOrder);
  const [saving, setSaving] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const commitOrder = useCallback((next: typeof boardOrder) => {
    boardOrderRef.current = next;
    setProjectedOrder(next);
  }, []);

  const projectOrder = useCallback(
    (
      event: Pick<DragOverEvent, "active" | "over" | "activatorEvent" | "delta">,
      current: typeof boardOrder
    ) => {
      if (!event.over) return null;
      const sourceId = String(event.active.id);
      const data = event.over.data.current;
      const destination =
        typeof data?.workflowStateId === "string" ? stateById.get(data.workflowStateId) : null;
      if (!destination || (data?.kind !== "column" && data?.kind !== "task")) return null;
      if (!isManuallyMovable(destination)) return null;
      const targetIds = (current[destination.id] ?? []).filter((id) => id !== sourceId);
      let index = targetIds.length;
      if (data.kind === "task") {
        const targetId = String(event.over.id);
        if (targetId === sourceId) return current;
        const overIndex = targetIds.indexOf(targetId);
        if (overIndex < 0) return null;
        const translated = event.active.rect.current.translated;
        const keyboardDirection =
          event.activatorEvent instanceof KeyboardEvent ? Math.sign(event.delta.y) : 0;
        const after =
          keyboardDirection > 0 ||
          (keyboardDirection === 0 &&
            translated != null &&
            translated.top > event.over.rect.top + event.over.rect.height / 2);
        index = overIndex + (after ? 1 : 0);
      }
      return moveBoardTask(current, sourceId, destination.id, index);
    },
    [stateById]
  );

  const onDragStart = useCallback(() => {
    boardOrderRef.current = boardOrder;
    dragStartOrderRef.current = boardOrder;
  }, [boardOrder]);

  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const current = boardOrderRef.current;
      const next = projectOrder(event, current);
      if (next && !boardOrdersEqual(next, current)) commitOrder(next);
    },
    [commitOrder, projectOrder]
  );

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const sourceId = String(event.active.id);
      const start = dragStartOrderRef.current;
      const final = event.over ? projectOrder(event, boardOrderRef.current) : null;
      if (!final || boardOrdersEqual(start, final)) {
        setProjectedOrder(null);
        return;
      }
      commitOrder(final);
      const placement = placementForTask(final, sourceId);
      const task = taskById.get(sourceId);
      const state = placement ? stateById.get(placement.workflowStateId) : null;
      if (!placement || !task || !state) {
        setProjectedOrder(null);
        return;
      }
      setSaving(true);
      try {
        await props.onMoveTask(task, state, placement.beforeTaskId, placement.afterTaskId);
      } catch {
        boardOrderRef.current = start;
      } finally {
        setSaving(false);
        setProjectedOrder(null);
      }
    },
    [commitOrder, projectOrder, props, stateById, taskById]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setProjectedOrder(null)}
    >
      <div className="flex h-full min-h-[500px] min-w-max items-stretch">
        {states.map((state) => (
          <BoardColumn
            key={state.id}
            state={state}
            tasks={(boardOrder[state.id] ?? [])
              .map((id) => taskById.get(id))
              .filter((task): task is CrewTaskListItemDTO => task != null)}
            props={props}
            draggable={props.canManage && !saving && isManuallyMovable(state)}
          />
        ))}
        {props.canManage ? (
          <button
            type="button"
            onClick={() => props.onCreateWorkflowState(states.at(-1)?.id ?? null)}
            className="grid h-10 w-11 shrink-0 place-items-center border-r border-white/[0.06] text-[#555c67] hover:bg-white/[0.03] hover:text-white"
            aria-label={t("addWorkflowColumn")}
          >
            <IconPlus className="size-3.5" />
          </button>
        ) : null}
      </div>
    </DndContext>
  );
}

function BoardColumn({
  state,
  tasks,
  props,
  draggable,
}: {
  state: CrewTaskWorkflowStateDTO;
  tasks: CrewTaskListItemDTO[];
  props: TaskProjectViewProps;
  draggable: boolean;
}) {
  const t = useTranslations("crewTaskProject");
  const { setNodeRef, isOver } = useDroppable({
    id: `workflow:${state.id}`,
    disabled: !draggable,
    data: { kind: "column", workflowStateId: state.id },
  });

  return (
    <section
      className={cn(
        "flex w-[339px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0b0c0f]",
        isOver && "bg-white/[0.02]"
      )}
    >
      <header className="flex h-10 items-center gap-2 border-b border-white/[0.06] px-3">
        <StatusMark state={state} />
        <span className="truncate text-[11px] font-medium text-[#c8cbd1]">
          {workflowStateLabel(state, t)}
        </span>
        <span className="text-[10px] tabular-nums text-[#666d77]">
          {props.workflowCounts?.[state.id] ?? tasks.length}
        </span>
        {props.canManage ? (
          <button
            type="button"
            onClick={() => props.onEditWorkflowState(state)}
            className="ml-auto grid size-6 place-items-center rounded text-[#555c67] hover:bg-white/[0.05] hover:text-white"
            aria-label={t("editWorkflowColumn", { name: state.name })}
          >
            <IconDots className="size-3.5" />
          </button>
        ) : null}
        {props.canCreate ? (
          <button
            type="button"
            onClick={() => props.onCreateTask(state.id)}
            className="grid size-6 place-items-center rounded text-[#555c67] hover:bg-white/[0.05] hover:text-white"
            aria-label={t("addTaskToColumn", { name: state.name })}
          >
            <IconPlus className="size-3.5" />
          </button>
        ) : null}
      </header>
      <div ref={setNodeRef} className="min-h-24 flex-1 space-y-2 p-2">
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <BoardCard
              key={task.id}
              task={task}
              stateId={state.id}
              props={props}
              draggable={draggable}
            />
          ))}
        </SortableContext>
        {props.canCreate ? (
          <button
            type="button"
            onClick={() => props.onCreateTask(state.id)}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[10px] text-[#555c67] hover:bg-white/[0.035] hover:text-[#9da2ac]"
          >
            <IconPlus className="size-3.5" />
            {t("addIssue")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function BoardCard({
  task,
  stateId,
  props,
  draggable,
}: {
  task: CrewTaskListItemDTO;
  stateId: string;
  props: TaskProjectViewProps;
  draggable: boolean;
}) {
  const t = useTranslations("crewTaskProject");
  const locale = useLocale();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
    data: { kind: "task", workflowStateId: stateId },
  });
  const properties = new Set(props.view.visibleFields);
  const state = props.workflowStates.find((item) => item.id === stateId);

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => props.onOpenTask(task.id)}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group block min-h-[116.5px] w-full rounded-[8px] bg-[#17171a] p-2 text-left shadow-[0_0_0_0.5px_rgba(255,255,255,0.083),0_0.5px_1px_1px_rgba(0,0,0,0.3)] outline-none transition-[background-color,box-shadow,opacity] hover:bg-[#1a1a1d] focus-visible:shadow-[0_0_0_1px_rgba(255,255,255,0.18),0_0_0_3px_rgba(229,34,39,0.32)]",
        draggable && "cursor-grab touch-none select-none active:cursor-grabbing",
        isDragging && "z-30 opacity-70 shadow-2xl"
      )}
    >
      <div className="relative h-[36.5px]">
        <span className="ml-1 block text-[12px] leading-[14.5px] font-[450] tracking-[-0.24px] text-[#929299]">
          TASK-{task.number}
        </span>
        <span className="mt-[6px] flex h-4 min-w-0 items-center gap-1.5 pl-1 pr-6">
          <StatusMark state={state} className="size-3.5 shrink-0" />
          <span className="block min-w-0 truncate text-[13px] leading-4 font-medium tracking-[-0.13px] text-white">
            {task.title}
          </span>
          <TaskUnreadMarker taskId={task.id} />
        </span>
      </div>

      {properties.has("assignees") ? <TaskAssignees task={task} displays={props.displays} /> : null}

      <div className="mt-[10px] flex min-h-6 min-w-0 flex-wrap items-center gap-1.5">
        {properties.has("priority") ? <CardPriorityProperty priority={task.priority} /> : null}
        {properties.has("labels") && task.labels.length > 0
          ? task.labels.slice(0, 3).map((label) => (
              <span
                key={label.id}
                className="inline-flex h-6 max-w-[96px] shrink-0 items-center truncate rounded-full bg-white/[0.055] px-2 text-[10px] font-medium"
                style={{ color: label.color }}
              >
                {label.name}
              </span>
            ))
          : null}
        {properties.has("cycle") && task.cycle ? (
          <span
            className="inline-block h-6 max-w-40 shrink-0 truncate rounded-full bg-white/[0.055] px-2 py-1 text-[10px] text-[#929299]"
            title={`${t("filterCycle")}: ${task.cycle.name}`}
          >
            {task.cycle.name}
          </span>
        ) : null}
        {properties.has("dueAt") && task.dueAt ? (
          <TaskDeadline dueAt={task.dueAt} status={task.status} />
        ) : null}
      </div>

      <div className="mt-[6px] flex h-6 items-center">
        <time className="ml-0.5 text-[12px] leading-[14.5px] font-[450] tracking-[-0.24px] text-[#929299]">
          {t("createdOn", { date: shortDate(task.createdAt, locale) })}
        </time>
      </div>
    </button>
  );
}

function CardPriorityProperty({ priority }: { priority: CrewTaskPriority }) {
  const t = useTranslations("crewTaskProject");
  const iconClassName = "size-3.5";

  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full bg-[#242428] text-[#8f8f97]",
        priority === "urgent" && "text-red-300",
        priority === "high" && "text-orange-200",
        priority === "low" && "text-[#777780]"
      )}
      aria-label={t(`priority.${priority}`)}
      title={t(`priority.${priority}`)}
    >
      {priority === "urgent" ? (
        <IconUrgent className={iconClassName} stroke={1.8} />
      ) : priority === "high" ? (
        <IconAntennaBars5 className={iconClassName} stroke={1.8} />
      ) : priority === "low" ? (
        <IconAntennaBars1 className={iconClassName} stroke={1.8} />
      ) : (
        <IconDots className={iconClassName} stroke={1.8} />
      )}
    </span>
  );
}

function EmptyIssues({ onCreate }: { onCreate?: () => void }) {
  const t = useTranslations("crewTaskProject");
  return (
    <div className="grid min-h-[420px] place-items-center">
      <div className="text-center">
        <IconCircleDashed className="mx-auto size-7 text-[#555c67]" />
        <p className="mt-3 text-[12px] font-medium text-[#b9bdc5]">{t("noIssues")}</p>
        {onCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-[#e52227] px-3 text-[10px] font-medium text-white hover:bg-[#f02d32]"
          >
            <IconPlus className="size-3.5" />
            {t("newIssue")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function resolveListGroups(
  props: TaskProjectViewProps,
  t: ReturnType<typeof useTranslations>
): ListGroupValue[] {
  const { view, tasks, workflowStates, cycles, displays } = props;
  if (!view.groupBy) return tasks.length ? [{ key: "all", label: null, tasks }] : [];
  if (view.groupBy === "status") {
    const groups = workflowStates
      .filter((state) => !state.archived)
      .map((state) => ({
        key: state.id,
        label: workflowStateLabel(state, t),
        color: state.color,
        state,
        tasks: tasks.filter((task) => task.workflowStateId === state.id),
      }));
    return view.showEmptyGroups ? groups : groups.filter((group) => group.tasks.length > 0);
  }
  if (view.groupBy === "priority") {
    const groups = (["urgent", "high", "normal", "low"] as CrewTaskPriority[]).map((priority) => ({
      key: priority,
      label: t(`priority.${priority}`),
      tasks: tasks.filter((task) => task.priority === priority),
    }));
    return view.showEmptyGroups ? groups : groups.filter((group) => group.tasks.length > 0);
  }
  if (view.groupBy === "cycle") {
    const groups = [
      { key: "none", label: t("noCycle"), tasks: tasks.filter((task) => !task.cycleId) },
      ...cycles.map((cycle) => ({
        key: cycle.id,
        label: cycle.name,
        tasks: tasks.filter((task) => task.cycleId === cycle.id),
      })),
    ];
    return view.showEmptyGroups ? groups : groups.filter((group) => group.tasks.length > 0);
  }
  const ids = [...new Set(tasks.flatMap((task) => task.assignees.map((item) => item.userId)))];
  const groups = [
    { key: "none", label: t("unassigned"), tasks: tasks.filter((task) => !task.assignees.length) },
    ...ids.map((id) => ({
      key: id,
      label: displayNameOf(id, displays),
      tasks: tasks.filter((task) => task.assignees.some((item) => item.userId === id)),
    })),
  ];
  return view.showEmptyGroups ? groups : groups.filter((group) => group.tasks.length > 0);
}

export function StatusMark({
  state,
  color,
  className,
}: {
  state?: CrewTaskWorkflowStateDTO;
  color?: string;
  className?: string;
}) {
  const style = { color: state?.color ?? color ?? "#8B919B" };
  if (!state) return <IconCircle className={cn("size-3.5", className)} style={style} />;
  const lower = state.name.toLowerCase();
  if (lower.includes("backlog")) {
    return <IconCircleDashed className={cn("size-3.5", className)} style={style} />;
  }
  if (state.semantic === "approved") {
    return <IconCircleCheckFilled className={cn("size-3.5", className)} style={style} />;
  }
  if (state.semantic === "cancelled") {
    return <IconCircleXFilled className={cn("size-3.5", className)} style={style} />;
  }
  if (state.semantic === "in_progress" || state.semantic === "submitted") {
    return <IconCircleDot className={cn("size-3.5", className)} style={style} />;
  }
  return <IconCircle className={cn("size-3.5", className)} style={style} />;
}

function PriorityMark({ priority }: { priority: CrewTaskPriority }) {
  const t = useTranslations("crewTaskProject");
  if (priority === "normal") return null;
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-0.5 text-[8px] font-medium",
        priority === "urgent" && "border-red-400/25 text-red-300",
        priority === "high" && "border-orange-300/25 text-orange-200",
        priority === "low" && "border-white/[0.1] text-[#818792]"
      )}
    >
      {t(`priority.${priority}`)}
    </span>
  );
}

function isManuallyMovable(state: CrewTaskWorkflowStateDTO) {
  return ["open", "in_progress", "revision_requested"].includes(state.semantic);
}

function isCoreBoardColumn(state: CrewTaskWorkflowStateDTO) {
  return ["backlog", "open", "in_progress", "approved"].includes(state.systemKey ?? "");
}

function shortDate(value: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(
    new Date(value)
  );
}

function TaskAssignees({
  task,
  displays,
}: Pick<TaskProjectViewProps, "displays"> & { task: TaskProjectViewProps["tasks"][number] }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      {task.assignees.map((assignee) => {
        const name = displayNameOf(assignee.userId, displays);
        return (
          <span
            key={assignee.userId}
            className="inline-flex min-w-0 items-center gap-1.5"
            title={name}
          >
            <UserAvatar
              src={displays.get(assignee.userId)?.avatar}
              seed={assignee.userId}
              name={name}
              size={20}
            />
            <span className="max-w-32 truncate text-[11px] text-[#a5aab2]">{name}</span>
          </span>
        );
      })}
    </span>
  );
}
