import { createSelector, createSlice, type PayloadAction } from "@reduxjs/toolkit";

// ─── Types ──────────────────────────────────────────────

export type TaskType = "image" | "video" | "audio";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface TaskOutput {
  storagePath?: string;
  url?: string;
  [key: string]: unknown;
}

export interface Task {
  id: string;
  remoteId?: string;
  type: TaskType;
  status: TaskStatus;
  projectId?: string;
  shotId?: string;
  shotColumnId?: string;
  input: Record<string, unknown>;
  output?: TaskOutput;
  error?: string;
  progress?: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskEvent {
  taskId: string;
  status: TaskStatus;
  type?: TaskType;
  output?: TaskOutput;
  error?: string;
  progress?: number;
}

// ─── Helpers ────────────────────────────────────────────

let counter = 0;

export function createTaskId(): string {
  counter += 1;
  return `task_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── State ──────────────────────────────────────────────

interface TaskState {
  tasks: Record<string, Task>;
}

const initialState: TaskState = {
  tasks: {},
};

// ─── Slice ──────────────────────────────────────────────

export const taskSlice = createSlice({
  name: "task",
  initialState,
  reducers: {
    addTask: (
      state,
      action: PayloadAction<
        Omit<Task, "id" | "status" | "createdAt" | "updatedAt"> & { id?: string }
      >
    ) => {
      const now = Date.now();
      const id = action.payload.id || createTaskId();
      state.tasks[id] = {
        ...action.payload,
        id,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };
    },

    startTask: (state, action: PayloadAction<string>) => {
      const task = state.tasks[action.payload];
      if (!task || task.status !== "pending") return;
      task.status = "running";
      task.startedAt = Date.now();
      task.updatedAt = Date.now();
    },

    completeTask: (state, action: PayloadAction<{ taskId: string; output: TaskOutput }>) => {
      const task = state.tasks[action.payload.taskId];
      if (!task) return;
      task.status = "completed";
      task.output = action.payload.output;
      task.error = undefined;
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
    },

    failTask: (state, action: PayloadAction<{ taskId: string; error: string }>) => {
      const task = state.tasks[action.payload.taskId];
      if (!task) return;
      task.status = "failed";
      task.error = action.payload.error;
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
    },

    cancelTask: (state, action: PayloadAction<string>) => {
      const task = state.tasks[action.payload];
      if (!task) return;
      task.status = "cancelled";
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
    },

    retryTask: (state, action: PayloadAction<string>) => {
      const task = state.tasks[action.payload];
      if (!task || (task.status !== "failed" && task.status !== "cancelled")) return;
      task.status = "pending";
      task.error = undefined;
      task.output = undefined;
      task.startedAt = undefined;
      task.completedAt = undefined;
      task.updatedAt = Date.now();
    },

    setTasks: (state, action: PayloadAction<Task[]>) => {
      state.tasks = {};
      for (const t of action.payload) state.tasks[t.id] = t;
    },

    removeTask: (state, action: PayloadAction<string>) => {
      delete state.tasks[action.payload];
    },

    clearCompleted: (
      state,
      action: PayloadAction<{ shotId?: string; shotColumnId?: string } | undefined>
    ) => {
      const { shotId, shotColumnId } = action.payload ?? {};
      for (const [id, task] of Object.entries(state.tasks)) {
        const isTerminal =
          task.status === "completed" || task.status === "failed" || task.status === "cancelled";
        if (!isTerminal) continue;
        if (shotId && task.shotId !== shotId) continue;
        if (shotColumnId && task.shotColumnId !== shotColumnId) continue;
        delete state.tasks[id];
      }
    },

    applyEvent: (state, action: PayloadAction<TaskEvent>) => {
      const event = action.payload;
      const now = Date.now();
      const isTerminal =
        event.status === "completed" || event.status === "failed" || event.status === "cancelled";
      const existing = state.tasks[event.taskId];

      if (existing) {
        existing.status = event.status;
        if (event.output) existing.output = event.output;
        if (event.error) existing.error = event.error;
        if (event.progress !== undefined) existing.progress = event.progress;
        if (event.status === "running") existing.startedAt = now;
        if (isTerminal) existing.completedAt = now;
        existing.updatedAt = now;
      } else if (event.type) {
        state.tasks[event.taskId] = {
          id: event.taskId,
          type: event.type,
          status: event.status,
          input: {},
          output: event.output,
          error: event.error,
          progress: event.progress,
          createdAt: now,
          updatedAt: now,
          completedAt: isTerminal ? now : undefined,
        };
      }
    },
  },
});

export const {
  addTask,
  startTask,
  completeTask,
  failTask,
  cancelTask,
  retryTask,
  setTasks,
  removeTask,
  clearCompleted,
  applyEvent,
} = taskSlice.actions;

// ─── Selectors ──────────────────────────────────────────

const selectTasks = (state: { task: TaskState }) => state.task.tasks;

export const selectTask = (state: { task: TaskState }, taskId: string) => state.task.tasks[taskId];

// Parameterized selectors — factory for memoization per call site
export const makeSelectTasksByShot = () =>
  createSelector(
    [
      selectTasks,
      (_: { task: TaskState }, shotId: string) => shotId,
      (_: { task: TaskState }, _shotId: string, shotColumnId: string) => shotColumnId,
    ],
    (tasks, shotId, shotColumnId) =>
      Object.values(tasks)
        .filter((t) => t.shotId === shotId && t.shotColumnId === shotColumnId)
        .sort((a, b) => b.createdAt - a.createdAt)
  );

// Non-memoized version for backwards compatibility
export const selectTasksByShot = (
  state: { task: TaskState },
  shotId: string,
  shotColumnId: string
) =>
  Object.values(state.task.tasks)
    .filter((t) => t.shotId === shotId && t.shotColumnId === shotColumnId)
    .sort((a, b) => b.createdAt - a.createdAt);

export const selectTasksByType = (state: { task: TaskState }, type: TaskType) =>
  Object.values(state.task.tasks)
    .filter((t) => t.type === type)
    .sort((a, b) => b.createdAt - a.createdAt);

// Memoized selectors — safe for useSelector
export const selectActiveTasks = createSelector([selectTasks], (tasks) =>
  Object.values(tasks)
    .filter((t) => t.status === "pending" || t.status === "running")
    .sort((a, b) => b.createdAt - a.createdAt)
);

export const selectPendingTasks = createSelector([selectTasks], (tasks) =>
  Object.values(tasks)
    .filter((t) => t.status === "pending")
    .sort((a, b) => a.createdAt - b.createdAt)
);

export const selectHasActiveTasks = (
  state: { task: TaskState },
  shotId?: string,
  shotColumnId?: string
) =>
  Object.values(state.task.tasks).some((t) => {
    if (t.status !== "pending" && t.status !== "running") return false;
    if (shotId && t.shotId !== shotId) return false;
    if (shotColumnId && t.shotColumnId !== shotColumnId) return false;
    return true;
  });
