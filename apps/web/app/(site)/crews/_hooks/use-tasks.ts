"use client";
import { useEffect } from "react";
import type { CrewProfessionalDeliveryInput } from "./types";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryFilters,
} from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewApi } from "./api";
import { crewKeys, crewTaskDetailQueries, crewAccountQueries } from "./shared";
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
  CrewTaskKindTemplateDTO,
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
  const { user } = useCurrentUser();
  const accountUserId = user?.id ?? null;
  return useQuery({
    queryKey: [...crewKeys.taskProject(crewId), accountUserId],
    enabled: Boolean(accountUserId) && enabled && Boolean(crewId),
    queryFn: ({ signal }) =>
      crewApi.get<CrewTaskProjectDTO>(`/crews/${encodeURIComponent(crewId)}/task-project`, {
        signal,
        cache: "no-store",
      }),
  });
}

export function useCrewTaskKindTemplates(crewId: string, enabled = true) {
  const { user } = useCurrentUser();
  const accountUserId = user?.id ?? null;
  return useQuery({
    queryKey: [...crewKeys.taskKindTemplates(crewId), accountUserId],
    enabled: Boolean(accountUserId) && enabled && Boolean(crewId),
    queryFn: ({ signal }) =>
      crewApi.get<{ items: CrewTaskKindTemplateDTO[] }>(
        `/crews/${encodeURIComponent(crewId)}/task-kind-templates`,
        { signal, cache: "no-store" }
      ),
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
  const { user } = useCurrentUser();
  const accountUserId = user?.id ?? null;
  const result = useInfiniteQuery({
    queryKey: [...crewKeys.taskView(crewId, input), accountUserId],
    enabled: Boolean(accountUserId) && enabled && Boolean(crewId) && Boolean(input.viewId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<CrewTaskPageDTO>(`/crews/${encodeURIComponent(crewId)}/tasks`, {
        signal,
        cache: "no-store",
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
  useCompleteTaskPages(
    result,
    enabled && Boolean(accountUserId) && Boolean(crewId) && Boolean(input.viewId)
  );
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
    recruitmentOnly?: boolean;
    activeOnly?: boolean;
    limit?: number;
  } = {},
  enabled = true
) {
  const { user } = useCurrentUser();
  const accountUserId = user?.id ?? null;
  const result = useInfiniteQuery({
    queryKey: [...crewKeys.taskOptions(crewId, input), accountUserId],
    enabled: Boolean(accountUserId) && enabled && Boolean(crewId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<CrewTaskOptionPageDTO>(`/crews/${encodeURIComponent(crewId)}/task-options`, {
        signal,
        cache: "no-store",
        query: {
          ...input,
          recruitmentOnly: input.recruitmentOnly ? "true" : undefined,
          activeOnly: input.activeOnly ? "true" : undefined,
          cursor: pageParam,
          limit: input.limit ?? 30,
        },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: input.recruitmentOnly ? 30_000 : false,
    refetchOnWindowFocus: true,
  });
  useCompleteTaskPages(result, enabled && Boolean(accountUserId) && Boolean(crewId));
  return {
    ...result,
    data: result.data?.pages.flatMap((page) => page.items) ?? [],
  };
}

export function useCrewTaskSummary(crewId: string, enabled = true) {
  const { user } = useCurrentUser();
  const accountUserId = user?.id ?? null;
  return useQuery({
    queryKey: [...crewKeys.taskSummary(crewId), accountUserId],
    enabled: Boolean(accountUserId) && enabled && Boolean(crewId),
    queryFn: ({ signal }) =>
      crewApi.get<CrewTaskSummaryDTO>(`/crews/${encodeURIComponent(crewId)}/task-summary`, {
        signal,
        cache: "no-store",
      }),
  });
}

export function useCrewTaskActivity(crewId: string, enabled = true) {
  const { user } = useCurrentUser();
  const accountUserId = user?.id ?? null;
  return useInfiniteQuery({
    queryKey: [...crewKeys.taskActivity(crewId), accountUserId],
    enabled: Boolean(accountUserId) && enabled && Boolean(crewId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<CrewTaskActivityPageDTO>(`/crews/${encodeURIComponent(crewId)}/task-activity`, {
        signal,
        cache: "no-store",
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
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: (input: SaveCrewTaskViewInput) =>
      crewApi.post<CrewTaskViewDTO>(`/crews/${encodeURIComponent(crewId)}/task-views`, {
        body: input,
      }),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      return qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
    },
  });
}

export function useUpdateCrewTaskView(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
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
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
    },
  });
}

export function useDeleteCrewTaskView(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: (viewId: string) =>
      crewApi.delete<void>(`/crew-task-views/${encodeURIComponent(viewId)}`),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      return qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
    },
  });
}

export function useCreateCrewTaskWorkflowState(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
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
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      return qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
    },
  });
}

export function useUpdateCrewTaskWorkflowState(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
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
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
      qc.invalidateQueries(crewTaskDetailQueries(crewId, undefined, accountUserId));
    },
  });
}

export function useReorderCrewTaskWorkflowStates(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: (states: Array<{ id: string; expectedVersion: number }>) =>
      crewApi.post<CrewTaskWorkflowStateDTO[]>(
        `/crews/${encodeURIComponent(crewId)}/task-workflow-states/reorder`,
        { body: { states } }
      ),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      return qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
    },
  });
}

export function useDeleteCrewTaskWorkflowState(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: (stateId: string) =>
      crewApi.delete<void>(`/crew-task-workflow-states/${encodeURIComponent(stateId)}`),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      return qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
    },
  });
}

export function useCreateCrewTaskCycle(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: (input: { name: string; goal: string; startAt: string; endAt: string }) =>
      crewApi.post<CrewTaskCycleDTO>(`/crews/${encodeURIComponent(crewId)}/task-cycles`, {
        body: input,
      }),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      return qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
    },
  });
}

export function useUpdateCrewTaskCycle(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
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
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
      qc.invalidateQueries(crewTaskDetailQueries(crewId, undefined, accountUserId));
    },
  });
}

export function useDeleteCrewTaskCycle(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: (cycleId: string) =>
      crewApi.delete<void>(`/crew-task-cycles/${encodeURIComponent(cycleId)}`),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
      qc.invalidateQueries(crewTaskDetailQueries(crewId, undefined, accountUserId));
    },
  });
}

export function useCreateCrewTaskLabel(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: (input: { name: string; color: string; description: string }) =>
      crewApi.post<CrewTaskLabelDTO>(`/crews/${encodeURIComponent(crewId)}/task-labels`, {
        body: input,
      }),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      return qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
    },
  });
}

export function useUpdateCrewTaskLabel(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
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
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
      qc.invalidateQueries(crewTaskDetailQueries(crewId, undefined, accountUserId));
    },
  });
}

export function useDeleteCrewTaskLabel(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: (labelId: string) =>
      crewApi.delete<void>(`/crew-task-labels/${encodeURIComponent(labelId)}`),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
      qc.invalidateQueries(crewTaskDetailQueries(crewId, undefined, accountUserId));
    },
  });
}

export function useCreateCrewTaskField(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
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
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      return qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
    },
  });
}

export function useUpdateCrewTaskField(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
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
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      return qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
    },
  });
}

export function useDeleteCrewTaskField(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: (fieldId: string) =>
      crewApi.delete<void>(`/crew-task-fields/${encodeURIComponent(fieldId)}`),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskProject(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
      qc.invalidateQueries(crewTaskDetailQueries(crewId, undefined, accountUserId));
    },
  });
}

export function useReorderCrewTask(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const accountUserId = user?.id ?? null;
  const taskViewQueries: QueryFilters = {
    queryKey: crewKeys.tasks(crewId),
    predicate: (query) => query.queryKey[3] === "view" && query.queryKey.at(-1) === accountUserId,
  };
  return useMutation({
    mutationKey: ["crew-task-reorder", crewId],
    scope: { id: `crew-task-reorder:${crewId}:${accountUserId}` },
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
        qc.cancelQueries({ queryKey: [...crewKeys.task(taskId), accountUserId] }),
      ]);
      const previousTaskViews = qc.getQueriesData<InfiniteData<CrewTaskPageDTO>>(taskViewQueries);
      const previousTask = qc.getQueryData<CrewTaskDTO>([...crewKeys.task(taskId), accountUserId]);
      const optimisticTaskViews = new Map<
        readonly unknown[],
        InfiniteData<CrewTaskPageDTO> | undefined
      >();
      let optimisticTask: CrewTaskListItemDTO | undefined;
      let optimisticDetail: CrewTaskDTO | undefined;

      for (const [queryKey, data] of previousTaskViews) {
        if (!data) continue;
        const optimisticData = {
          ...data,
          pages: optimisticallyReorderCrewTaskPages(data.pages, taskId, input, destinationState),
        };
        optimisticTaskViews.set(
          queryKey,
          qc.setQueryData<InfiniteData<CrewTaskPageDTO>>(queryKey, optimisticData)
        );
        optimisticTask ??= optimisticData.pages
          .flatMap((page) => page.items)
          .find((task) => task.id === taskId);
      }

      if (optimisticTask && previousTask) {
        optimisticDetail = qc.setQueryData<CrewTaskDTO>([...crewKeys.task(taskId), accountUserId], {
          ...previousTask,
          ...optimisticTask,
        });
      }

      return {
        previousTaskViews,
        previousTask,
        optimisticTaskViews,
        optimisticDetail,
        accountUserId,
        crewId,
        taskViewQueries,
      };
    },
    onError: (_error, { taskId }, context) => {
      if (!context?.accountUserId) return;
      const { accountUserId } = context;
      for (const [queryKey, data] of context?.previousTaskViews ?? []) {
        // Only undo the snapshot this request installed. A refresh or another
        // edit owns any newer cache value; settlement will reconcile its order.
        if (qc.getQueryData(queryKey) === context.optimisticTaskViews.get(queryKey)) {
          qc.setQueryData(queryKey, data);
        }
      }
      const detailKey = [...crewKeys.task(taskId), accountUserId];
      if (
        context.previousTask &&
        context.optimisticDetail &&
        qc.getQueryData(detailKey) === context.optimisticDetail
      ) {
        qc.setQueryData(detailKey, context.previousTask);
      }
    },
    onSuccess: (task, _variables, context) => {
      if (!context?.accountUserId) return;
      const { accountUserId, taskViewQueries } = context;
      qc.setQueryData<CrewTaskDTO>([...crewKeys.task(task.id), accountUserId], (current) =>
        current && current.version > task.version ? current : task
      );
      qc.setQueriesData<InfiniteData<CrewTaskPageDTO>>(taskViewQueries, (current) =>
        current ? replaceCrewTaskInPages(current, task) : current
      );
    },
    onSettled: (_task, _error, { taskId }, context) => {
      if (!context?.accountUserId) return;
      const { accountUserId, crewId, taskViewQueries } = context;
      void Promise.all([
        qc.invalidateQueries(taskViewQueries),
        qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId)),
        qc.invalidateQueries({ queryKey: [...crewKeys.task(taskId), accountUserId] }),
        qc.invalidateQueries(crewTaskDetailQueries(crewId, taskId, accountUserId)),
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
      items: page.items.map((candidate) =>
        candidate.id === task.id && candidate.version <= task.version ? task : candidate
      ),
    })),
  };
}

export function useBatchUpdateCrewTasks(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
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
    onSuccess: (tasks, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      for (const task of tasks) qc.setQueryData([...crewKeys.task(task.id), accountUserId], task);
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
    },
  });
}

export function useCrewTask(taskId: string, enabled = true) {
  const { user } = useCurrentUser();
  const accountUserId = user?.id ?? null;
  return useQuery({
    queryKey: [...crewKeys.task(taskId), accountUserId],
    enabled: Boolean(accountUserId) && enabled && Boolean(taskId),
    queryFn: ({ signal }) =>
      crewApi.get<CrewTaskDTO>(`/crew-tasks/${encodeURIComponent(taskId)}`, {
        signal,
        cache: "no-store",
      }),
  });
}

export function useCrewTaskTimeline(taskId: string, enabled = true) {
  const { user } = useCurrentUser();
  const accountUserId = user?.id ?? null;
  return useInfiniteQuery({
    queryKey: [...crewKeys.taskTimeline(taskId), accountUserId],
    enabled: Boolean(accountUserId) && enabled && Boolean(taskId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<CrewTaskTimelinePageDTO>(`/crew-tasks/${encodeURIComponent(taskId)}/timeline`, {
        signal,
        cache: "no-store",
        query: { cursor: pageParam, limit: 30 },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useCreateCrewTask(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: (input: CreateCrewTaskInput) =>
      crewApi.post<CrewTaskDTO>(`/crews/${encodeURIComponent(crewId)}/tasks`, { body: input }),
    onSuccess: (task, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      qc.invalidateQueries(crewAccountQueries(crewKeys.assets(crewId), accountUserId));
      qc.setQueryData([...crewKeys.task(task.id), accountUserId], task);
      qc.invalidateQueries(crewTaskDetailQueries(crewId, task.id, accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskSummary(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskActivity(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.productionOverview(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.episodes(crewId), accountUserId));
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
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: ({ taskId, input }: { taskId: string; input: UpdateCrewTaskInput }) =>
      crewApi.patch<CrewTaskDTO>(`/crew-tasks/${encodeURIComponent(taskId)}`, {
        body: input,
      }),
    onSuccess: (task, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      qc.setQueryData([...crewKeys.task(task.id), accountUserId], task);
      qc.invalidateQueries(crewTaskDetailQueries(crewId, task.id, accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskTimeline(task.id), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskSummary(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskActivity(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.productionOverview(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.episodes(crewId), accountUserId));
    },
  });
}

export function useDeleteCrewTask(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: ({ taskId, expectedVersion }: { taskId: string; expectedVersion: number }) =>
      crewApi.delete<void>(`/crew-tasks/${encodeURIComponent(taskId)}`, {
        body: { expectedVersion },
      }),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      // Reparented children and unblocked tasks can have open detail queries too.
      qc.invalidateQueries(crewTaskDetailQueries(crewId, undefined, accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskSummary(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskActivity(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.productionOverview(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.episodes(crewId), accountUserId));
    },
  });
}

export function useCreateCrewTaskComment(crewId: string, taskId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId, taskId }),
    mutationFn: (input: CreateCrewTaskCommentInput) =>
      crewApi.post<CrewTaskTimelineItemDTO>(`/crew-tasks/${encodeURIComponent(taskId)}/comments`, {
        body: input,
      }),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId, taskId } = origin;
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskTimeline(taskId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
    },
  });
}

export function useUpdateCrewTaskComment(taskId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, taskId }),
    mutationFn: ({ commentId, input }: { commentId: string; input: UpdateCrewTaskCommentInput }) =>
      crewApi.patch<CrewTaskTimelineItemDTO>(
        `/crew-task-comments/${encodeURIComponent(commentId)}`,
        { body: input }
      ),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, taskId } = origin;
      return qc.invalidateQueries(crewAccountQueries(crewKeys.taskTimeline(taskId), accountUserId));
    },
  });
}

export function useDeleteCrewTaskComment(taskId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, taskId }),
    mutationFn: (commentId: string) =>
      crewApi.delete<void>(`/crew-task-comments/${encodeURIComponent(commentId)}`),
    onSuccess: (_data, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, taskId } = origin;
      return qc.invalidateQueries(crewAccountQueries(crewKeys.taskTimeline(taskId), accountUserId));
    },
  });
}

export function useSetTaskDeliveryFolder(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: ({
      taskId,
      deliveryFolderId,
    }: {
      taskId: string;
      deliveryFolderId: string | null;
    }) =>
      crewApi.put<CrewTaskDTO>(`/crew-tasks/${encodeURIComponent(taskId)}/delivery-folder`, {
        body: { deliveryFolderId },
      }),
    onSuccess: (task, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      qc.invalidateQueries(crewAccountQueries(crewKeys.assets(crewId), accountUserId));
      qc.setQueryData([...crewKeys.task(task.id), accountUserId], task);
      qc.invalidateQueries(crewTaskDetailQueries(crewId, task.id, accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskTimeline(task.id), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskSummary(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskActivity(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.productionOverview(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.episodes(crewId), accountUserId));
    },
  });
}

export function useSubmitCrewTask(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: ({
      taskId,
      note,
      assetNodeIds = [],
      deliveryFolderId,
      professionalDelivery,
    }: {
      taskId: string;
      note: string;
      assetNodeIds?: string[];
      deliveryFolderId?: string;
      professionalDelivery?: CrewProfessionalDeliveryInput;
    }) =>
      crewApi.post<CrewTaskDTO>(`/crew-tasks/${encodeURIComponent(taskId)}/submissions`, {
        body: {
          note,
          assetNodeIds,
          ...(professionalDelivery ? { professionalDelivery } : {}),
          ...(deliveryFolderId ? { deliveryFolderId } : {}),
        },
      }),
    onSuccess: (task, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      qc.invalidateQueries(crewAccountQueries(crewKeys.assets(crewId), accountUserId));
      qc.setQueryData([...crewKeys.task(task.id), accountUserId], task);
      qc.invalidateQueries(crewTaskDetailQueries(crewId, task.id, accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskTimeline(task.id), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskSummary(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskActivity(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.productionOverview(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.episodes(crewId), accountUserId));
    },
  });
}

export function useReviewCrewTask(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null, crewId }),
    mutationFn: ({
      taskId,
      expectedSubmissionId,
      decision,
      note,
      revisionDueAt,
      bindAssetNodeId,
    }: {
      taskId: string;
      expectedSubmissionId: string;
      decision: "approve" | "request_revision";
      note: string;
      revisionDueAt?: string;
      bindAssetNodeId?: string;
    }) =>
      crewApi.post<CrewTaskDTO>(`/crew-tasks/${encodeURIComponent(taskId)}/review`, {
        body: {
          decision,
          note,
          expectedSubmissionId,
          ...(revisionDueAt !== undefined ? { revisionDueAt } : {}),
          ...(bindAssetNodeId !== undefined ? { bindAssetNodeId } : {}),
        },
      }),
    onSuccess: (task, _variables, origin) => {
      if (!origin?.accountUserId) return;
      const { accountUserId, crewId } = origin;
      qc.invalidateQueries(crewAccountQueries(crewKeys.assets(crewId), accountUserId));
      qc.setQueryData([...crewKeys.task(task.id), accountUserId], task);
      qc.invalidateQueries(crewTaskDetailQueries(crewId, task.id, accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskTimeline(task.id), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskSummary(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.taskActivity(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.earnings(crewId, "mine"), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.earnings(crewId, "crew"), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.productionOverview(crewId), accountUserId));
      qc.invalidateQueries(crewAccountQueries(crewKeys.episodes(crewId), accountUserId));
    },
  });
}

function useCompleteTaskPages(
  query: {
    hasNextPage: boolean;
    isFetching: boolean;
    isError: boolean;
    fetchNextPage: () => Promise<unknown>;
  },
  enabled: boolean
) {
  const { hasNextPage, isFetching, isError, fetchNextPage } = query;
  useEffect(() => {
    if (enabled && hasNextPage && !isFetching && !isError) void fetchNextPage();
  }, [enabled, hasNextPage, isFetching, isError, fetchNextPage]);
}
