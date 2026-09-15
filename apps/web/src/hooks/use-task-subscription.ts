"use client";

import { useLayoutEffect, useCallback, useState, useRef } from "react";
import { api } from "@/src/lib/api";
import { store, useAppDispatch } from "@/src/store";
import {
  addTask,
  setTaskOwner,
  reconcileTaskSnapshot,
  applyEvent,
  type Task,
  type TaskEvent,
} from "@/src/store/slices/taskSlice";

/**
 * Fetch tasks on mount and populate the store.
 */
export function useTaskFetch(userId: string | undefined) {
  const dispatch = useAppDispatch();
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<{ userId?: string; revision: number; error: string | null }>(
    { revision: -1, error: null }
  );
  const pending = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    dispatch(setTaskOwner(userId ?? null));
  }, [userId, dispatch]);
  useLayoutEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    pending.current = controller;
    const baseline = store.getState().task.tasks;

    api
      .get<Task[]>("/aurora/api/tasks", { signal: controller.signal })
      .then((tasks) => {
        if (controller.signal.aborted) return;
        dispatch(reconcileTaskSnapshot({ tasks, baseline }));
        pending.current = null;
        setStatus({ userId, revision, error: null });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        pending.current = null;
        setStatus({ userId, revision, error: err instanceof Error ? err.message : "" });
      });
    return () => {
      controller.abort();
      if (pending.current === controller) pending.current = null;
    };
  }, [userId, dispatch, revision]);
  const retry = useCallback(() => {
    if (!userId || pending.current) return;
    pending.current = new AbortController();
    setRevision((value) => value + 1);
  }, [userId]);
  return {
    isLoading: !!userId && (status.userId !== userId || status.revision !== revision),
    error: status.userId === userId && status.revision === revision ? status.error : null,
    retry,
  };
}

/**
 * Apply a realtime task status event to the store.
 */
export function useTaskEventHandler() {
  const dispatch = useAppDispatch();

  return useCallback(
    (event: TaskEvent) => {
      dispatch(applyEvent(event));
    },
    [dispatch]
  );
}

/**
 * Hook to fetch full task detail on demand.
 */
export function useFetchTask() {
  const dispatch = useAppDispatch();

  return useCallback(
    async (taskId: string): Promise<Task | null> => {
      try {
        const task = await api.get<Task>(`/aurora/api/tasks/${taskId}`);
        dispatch(addTask(task));
        return task;
      } catch (err) {
        console.warn("[useFetchTask] Failed:", err);
      }
      return null;
    },
    [dispatch]
  );
}

/**
 * Hook to fetch agent progress (parent + steps).
 */
export function useFetchAgentProgress() {
  return useCallback(
    async (
      taskId: string
    ): Promise<{
      task: Task;
      steps: (Task & { stepResult?: Record<string, unknown> })[];
      currentStep: number;
      totalSteps: number;
    } | null> => {
      try {
        return await api.get<{
          task: Task;
          steps: (Task & { stepResult?: Record<string, unknown> })[];
          currentStep: number;
          totalSteps: number;
        }>(`/aurora/api/tasks/${taskId}/progress`);
      } catch (err) {
        console.warn("[useFetchAgentProgress] Failed:", err);
      }
      return null;
    },
    []
  );
}
