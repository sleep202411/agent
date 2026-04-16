import { useEffect, useRef, useCallback } from "react";
import { api } from "@/src/lib/api";
import { useAppSelector, useAppDispatch } from "@/src/store";
import {
  addTask,
  setTasks,
  applyEvent,
  type Task,
  type TaskEvent,
} from "@/src/store/slices/taskSlice";

/**
 * Fetch tasks on mount and populate the store.
 */
export function useTaskFetch(userId: string | undefined) {
  const dispatch = useAppDispatch();
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!userId || fetchedRef.current) return;
    fetchedRef.current = true;

    api
      .get<Task[]>("/aurora/api/tasks")
      .then((tasks) => {
        dispatch(setTasks(tasks));
      })
      .catch((err) => {
        console.warn("[useTaskFetch] Failed to fetch tasks:", err);
      });
  }, [userId, dispatch]);
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
