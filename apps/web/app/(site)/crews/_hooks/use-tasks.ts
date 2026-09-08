"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryFilters,
} from "@tanstack/react-query";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import {
  optimisticallyReorderCrewTaskPages,
  type ReorderCrewTaskCommand,
} from "../_lib/task-board-ordering";
import type {
  CreateCrewTaskCommentInput,
  CreateCrewTaskInput,
  CrewTaskDraftDTO,
  DraftCrewTaskInput,
  CrewTaskDTO,
  CrewTaskListItemDTO,
  CrewTaskOptionPageDTO,
  CrewTaskPageDTO,
  CrewTaskFieldDTO,
  CrewTaskFieldType,
  CrewTaskLabelDTO,
  CrewTaskCycleDTO,
  CrewTaskProjectDTO,
  CrewTaskSummaryDTO,
  CrewTaskViewDTO,
  CrewTaskWorkflowStateDTO,
  CrewTaskViewGroup,
  CrewTaskViewLayout,
  CrewTaskCompletedMode,
  CrewTaskTimelineItemDTO,
  CrewTaskTimelinePageDTO,
  CrewTaskActivityPageDTO,
  UpdateCrewTaskCommentInput,
  UpdateCrewTaskInput,
} from "./types";

export function useCrewTaskProject(crewId: string, enabled = true) {
  return useQuery({
    queryKey: crewKeys.taskProject(crewId),
    enabled: enabled && Boolean(crewId),
    queryFn: () =>
      crewApi.get<CrewTaskProjectDTO>(`/crews/${encodeURIComponent(crewId)}/task-project`),
  });
}

export function useCrewTaskView(
  crewId: string,
  input: {
    viewId: string;
    query?: string;
    priority?: CrewTaskDTO["priority"];
  },
  enabled = true
) {
  const result = useInfiniteQuery({
    queryKey: crewKeys.taskView(crewId, input),
    enabled: enabled && Boolean(crewId) && Boolean(input.viewId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewTaskPageDTO>(`/crews/${encodeURIComponent(crewId)}/tasks`, {
        query: {
          viewId: input.viewId,
          query: input.query || undefined,
          priority: input.priority,
          cursor: pageParam,
          limit: 50,
        },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  return {
    ...result,
    data: result.data?.pages.flatMap((page) => page.items) ?? [],
    total: result.data?.pages[0]?.total ?? 0,
    workflowCounts: result.data?.pages[0]?.workflowCounts ?? {},
  };
}

export function useCrewTaskOptions(
  crewId: string,
  input: {
    query?: string;
    excludeTaskId?: string;
    activeOnly?: boolean;
    limit?: number;
  } = {},
  enabled = true
) {
  const result = useInfiniteQuery({
    queryKey: crewKeys.taskOptions(crewId, input),
    enabled: enabled && Boolean(crewId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewTaskOptionPageDTO>(`/crews/${encodeURIComponent(crewId)}/task-options`, {
        query: {
          ...input,
          activeOnly: input.activeOnly ? "true" : undefined,
          cursor: pageParam,
          limit: input.limit ?? 30,
        },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  return {
    ...result,
    data: result.data?.pages.flatMap((page) => page.items) ?? [],
  };
}

export function useCrewTaskSummary(crewId: string, enabled = true) {
  return useQuery({
    queryKey: crewKeys.taskSummary(crewId),
    enabled: enabled && Boolean(crewId),
    queryFn: () =>
      crewApi.get<CrewTaskSummaryDTO>(`/crews/${encodeURIComponent(crewId)}/task-summary`),
  });
}

export function useCrewTaskActivity(crewId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: crewKeys.taskActivity(crewId),
    enabled: enabled && Boolean(crewId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewTaskActivityPageDTO>(`/crews/${encodeURIComponent(crewId)}/task-activity`, {
        query: { cursor: pageParam, limit: 30 },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export interface SaveCrewTaskViewInput {
  name: string;
  layout: CrewTaskViewLayout;
  groupBy: CrewTaskViewGroup;
  filters: CrewTaskViewDTO["filters"];
  sorts: CrewTaskViewDTO["sorts"];
  visibleFields: string[];
  completedMode: CrewTaskCompletedMode;
  showSubIssues: boolean;
  showEmptyGroups: boolean;
}

export function useCreateCrewTaskView(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveCrewTaskViewInput) =>
      crewApi.post<CrewTaskViewDTO>(`/crews/${encodeURIComponent(crewId)}/task-views`, {
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) }),
  });
}

export function useUpdateCrewTaskView(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      viewId,
      input,
    }: {
      viewId: string;
      input: Partial<SaveCrewTaskViewInput> & { expectedUpdatedAt: string };
    }) =>
      crewApi.patch<CrewTaskViewDTO>(`/crew-task-views/${encodeURIComponent(viewId)}`, {
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) }),
  });
}

export function useDeleteCrewTaskView(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (viewId: string) =>
      crewApi.delete<void>(`/crew-task-views/${encodeURIComponent(viewId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) }),
  });
}

export function useCreateCrewTaskWorkflowState(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      color: string;
      semantic: CrewTaskWorkflowStateDTO["semantic"];
      afterStateId?: string | null;
    }) =>
      crewApi.post<CrewTaskWorkflowStateDTO>(
        `/crews/${encodeURIComponent(crewId)}/task-workflow-states`,
        { body: input }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) }),
  });
}

export function useUpdateCrewTaskWorkflowState(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      stateId,
      input,
    }: {
      stateId: string;
      input: {
        expectedVersion: number;
        name?: string;
        color?: string;
        archived?: boolean;
        replacementStateId?: string;
      };
    }) =>
      crewApi.patch<CrewTaskWorkflowStateDTO>(
        `/crew-task-workflow-states/${encodeURIComponent(stateId)}`,
        { body: input }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) });
    },
  });
}

export function useReorderCrewTaskWorkflowStates(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (states: Array<{ id: string; expectedVersion: number }>) =>
      crewApi.post<CrewTaskWorkflowStateDTO[]>(
        `/crews/${encodeURIComponent(crewId)}/task-workflow-states/reorder`,
        { body: { states } }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) }),
  });
}

export function useDeleteCrewTaskWorkflowState(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stateId: string) =>
      crewApi.delete<void>(`/crew-task-workflow-states/${encodeURIComponent(stateId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) }),
  });
}

export function useCreateCrewTaskCycle(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; goal: string; startAt: string; endAt: string }) =>
      crewApi.post<CrewTaskCycleDTO>(`/crews/${encodeURIComponent(crewId)}/task-cycles`, {
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) }),
  });
}

export function useUpdateCrewTaskCycle(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      cycleId,
      input,
    }: {
      cycleId: string;
      input: Partial<Pick<CrewTaskCycleDTO, "name" | "goal" | "status" | "startAt" | "endAt">> & {
        expectedUpdatedAt: string;
      };
    }) =>
      crewApi.patch<CrewTaskCycleDTO>(`/crew-task-cycles/${encodeURIComponent(cycleId)}`, {
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) });
    },
  });
}

export function useDeleteCrewTaskCycle(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cycleId: string) =>
      crewApi.delete<void>(`/crew-task-cycles/${encodeURIComponent(cycleId)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) });
    },
  });
}

export function useCreateCrewTaskLabel(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color: string; description: string }) =>
      crewApi.post<CrewTaskLabelDTO>(`/crews/${encodeURIComponent(crewId)}/task-labels`, {
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) }),
  });
}

export function useUpdateCrewTaskLabel(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      labelId,
      input,
    }: {
      labelId: string;
      input: Partial<Pick<CrewTaskLabelDTO, "name" | "color" | "description">> & {
        expectedUpdatedAt: string;
      };
    }) =>
      crewApi.patch<CrewTaskLabelDTO>(`/crew-task-labels/${encodeURIComponent(labelId)}`, {
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) });
    },
  });
}

export function useDeleteCrewTaskLabel(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) =>
      crewApi.delete<void>(`/crew-task-labels/${encodeURIComponent(labelId)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) });
    },
  });
}

export function useCreateCrewTaskField(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      description: string;
      type: CrewTaskFieldType;
      options: CrewTaskFieldDTO["options"];
      required: boolean;
    }) =>
      crewApi.post<CrewTaskFieldDTO>(`/crews/${encodeURIComponent(crewId)}/task-fields`, {
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) }),
  });
}

export function useUpdateCrewTaskField(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      fieldId,
      input,
    }: {
      fieldId: string;
      input: Partial<Pick<CrewTaskFieldDTO, "name" | "description" | "options" | "required">> & {
        expectedUpdatedAt: string;
      };
    }) =>
      crewApi.patch<CrewTaskFieldDTO>(`/crew-task-fields/${encodeURIComponent(fieldId)}`, {
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) }),
  });
}

export function useDeleteCrewTaskField(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fieldId: string) =>
      crewApi.delete<void>(`/crew-task-fields/${encodeURIComponent(fieldId)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.taskProject(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) });
    },
  });
}

export function useReorderCrewTask(crewId: string) {
  const qc = useQueryClient();
  const taskViewQueries: QueryFilters = {
    queryKey: crewKeys.tasks(crewId),
    predicate: (query) => query.queryKey[3] === "view",
  };
  return useMutation({
    mutationKey: ["crew-task-reorder", crewId],
    scope: { id: `crew-task-reorder:${crewId}` },
    mutationFn: ({
      taskId,
      input,
    }: {
      taskId: string;
      input: ReorderCrewTaskCommand;
      destinationState: CrewTaskWorkflowStateDTO;
    }) =>
      crewApi.post<CrewTaskDTO>(`/crew-tasks/${encodeURIComponent(taskId)}/reorder`, {
        body: input,
      }),
    onMutate: async ({ taskId, input, destinationState }) => {
      await Promise.all([
        qc.cancelQueries(taskViewQueries),
        qc.cancelQueries({ queryKey: crewKeys.task(taskId) }),
      ]);
      const previousTaskViews = qc.getQueriesData<InfiniteData<CrewTaskPageDTO>>(taskViewQueries);
      const previousTask = qc.getQueryData<CrewTaskDTO>(crewKeys.task(taskId));
      let optimisticTask: CrewTaskListItemDTO | undefined;

      for (const [queryKey, data] of previousTaskViews) {
        if (!data) continue;
        const optimisticData = {
          ...data,
          pages: optimisticallyReorderCrewTaskPages(data.pages, taskId, input, destinationState),
        };
        qc.setQueryData(queryKey, optimisticData);
        optimisticTask ??= optimisticData.pages
          .flatMap((page) => page.items)
          .find((task) => task.id === taskId);
      }

      if (optimisticTask && previousTask) {
        qc.setQueryData<CrewTaskDTO>(crewKeys.task(taskId), {
          ...previousTask,
          ...optimisticTask,
        });
      }

      return { previousTaskViews, previousTask };
    },
    onError: (_error, { taskId }, context) => {
      for (const [queryKey, data] of context?.previousTaskViews ?? []) {
        qc.setQueryData(queryKey, data);
      }
      if (context?.previousTask) {
        qc.setQueryData(crewKeys.task(taskId), context.previousTask);
      }
    },
    onSuccess: (task) => {
      qc.setQueryData(crewKeys.task(task.id), task);
      qc.setQueriesData<InfiniteData<CrewTaskPageDTO>>(taskViewQueries, (current) =>
        current ? replaceCrewTaskInPages(current, task) : current
      );
    },
    onSettled: (_task, _error, { taskId }) => {
      void Promise.all([
        qc.invalidateQueries(taskViewQueries),
        qc.invalidateQueries({ queryKey: crewKeys.task(taskId) }),
      ]);
    },
  });
}

function replaceCrewTaskInPages(
  data: InfiniteData<CrewTaskPageDTO>,
  task: CrewTaskDTO
): InfiniteData<CrewTaskPageDTO> {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((candidate) => (candidate.id === task.id ? task : candidate)),
    })),
  };
}

export function useBatchUpdateCrewTasks(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      taskIds: string[];
      priority?: CrewTaskDTO["priority"];
      cycleId?: string | null;
      addLabelIds?: string[];
      removeLabelIds?: string[];
    }) =>
      crewApi.patch<CrewTaskDTO[]>(`/crews/${encodeURIComponent(crewId)}/tasks/batch`, {
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) }),
  });
}

export function useCrewTask(taskId: string, enabled = true) {
  return useQuery({
    queryKey: crewKeys.task(taskId),
    enabled: enabled && Boolean(taskId),
    queryFn: () => crewApi.get<CrewTaskDTO>(`/crew-tasks/${encodeURIComponent(taskId)}`),
  });
}

export function useCrewTaskTimeline(taskId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: crewKeys.taskTimeline(taskId),
    enabled: enabled && Boolean(taskId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewTaskTimelinePageDTO>(`/crew-tasks/${encodeURIComponent(taskId)}/timeline`, {
        query: { cursor: pageParam, limit: 30 },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useCreateCrewTask(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCrewTaskInput) =>
      crewApi.post<CrewTaskDTO>(`/crews/${encodeURIComponent(crewId)}/tasks`, { body: input }),
    onSuccess: (task) => {
      qc.setQueryData(crewKeys.task(task.id), task);
      qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.taskSummary(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.taskActivity(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.productionOverview(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodes(crewId) });
    },
  });
}

export function useDraftCrewTask(crewId: string) {
  return useMutation({
    mutationFn: (input: DraftCrewTaskInput) =>
      crewApi.post<CrewTaskDraftDTO>(`/crews/${encodeURIComponent(crewId)}/task-drafts`, {
        body: input,
      }),
  });
}

export function useUpdateCrewTask(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: UpdateCrewTaskInput }) =>
      crewApi.patch<CrewTaskDTO>(`/crew-tasks/${encodeURIComponent(taskId)}`, {
        body: input,
      }),
    onSuccess: (task) => {
      qc.setQueryData(crewKeys.task(task.id), task);
      qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.taskTimeline(task.id) });
      qc.invalidateQueries({ queryKey: crewKeys.taskSummary(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.taskActivity(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.productionOverview(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodes(crewId) });
    },
  });
}

export function useDeleteCrewTask(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, expectedVersion }: { taskId: string; expectedVersion: number }) =>
      crewApi.delete<void>(`/crew-tasks/${encodeURIComponent(taskId)}`, {
        body: { expectedVersion },
      }),
    onSuccess: () => {
      // Reparented children and unblocked tasks can have open detail queries too.
      qc.invalidateQueries({ queryKey: ["crew", "task"] });
      qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.taskSummary(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.taskActivity(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.productionOverview(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodes(crewId) });
    },
  });
}

export function useCreateCrewTaskComment(crewId: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCrewTaskCommentInput) =>
      crewApi.post<CrewTaskTimelineItemDTO>(`/crew-tasks/${encodeURIComponent(taskId)}/comments`, {
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.taskTimeline(taskId) });
      qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) });
    },
  });
}

export function useUpdateCrewTaskComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, input }: { commentId: string; input: UpdateCrewTaskCommentInput }) =>
      crewApi.patch<CrewTaskTimelineItemDTO>(
        `/crew-task-comments/${encodeURIComponent(commentId)}`,
        { body: input }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.taskTimeline(taskId) }),
  });
}

export function useDeleteCrewTaskComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      crewApi.delete<void>(`/crew-task-comments/${encodeURIComponent(commentId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.taskTimeline(taskId) }),
  });
}

export function useSubmitCrewTask(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      note,
      assetNodeIds = [],
    }: {
      taskId: string;
      note: string;
      assetNodeIds?: string[];
    }) =>
      crewApi.post<CrewTaskDTO>(`/crew-tasks/${encodeURIComponent(taskId)}/submissions`, {
        body: { note, assetNodeIds },
      }),
    onSuccess: (task) => {
      qc.setQueryData(crewKeys.task(task.id), task);
      qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.taskTimeline(task.id) });
      qc.invalidateQueries({ queryKey: crewKeys.taskSummary(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.taskActivity(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.productionOverview(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodes(crewId) });
    },
  });
}

export function useReviewCrewTask(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      decision,
      note,
    }: {
      taskId: string;
      decision: "approve" | "request_revision";
      note: string;
    }) =>
      crewApi.post<CrewTaskDTO>(`/crew-tasks/${encodeURIComponent(taskId)}/review`, {
        body: { decision, note },
      }),
    onSuccess: (task) => {
      qc.setQueryData(crewKeys.task(task.id), task);
      qc.invalidateQueries({ queryKey: crewKeys.tasks(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.taskTimeline(task.id) });
      qc.invalidateQueries({ queryKey: crewKeys.taskSummary(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.taskActivity(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.earnings(crewId, "mine") });
      qc.invalidateQueries({ queryKey: crewKeys.earnings(crewId, "crew") });
      qc.invalidateQueries({ queryKey: crewKeys.productionOverview(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodes(crewId) });
    },
  });
}
