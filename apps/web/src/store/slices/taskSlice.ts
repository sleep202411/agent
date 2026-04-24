import {
  createAsyncThunk,
  createSelector,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import { backendApi } from "@/src/lib/api";

// ─── Types ──────────────────────────────────────────────

export type TaskType = "image" | "video" | "audio" | "fusion" | "lip_sync";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/** Task origin: "local" = created by frontend queue, "server" = synced from backend */
export type TaskSource = "local" | "server";

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
  source: TaskSource;
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
        Omit<Task, "id" | "status" | "source" | "createdAt" | "updatedAt"> & {
          id?: string;
          source?: TaskSource;
        }
      >
    ) => {
      const now = Date.now();
      const id = action.payload.id || createTaskId();
      state.tasks[id] = {
        ...action.payload,
        id,
        source: action.payload.source ?? "local",
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

    /** Upsert server-synced tasks. Only touches source="server" tasks for the given scope. */
    upsertServerTasks: (state, action: PayloadAction<{ tasks: Task[]; shotColumnId?: string }>) => {
      const { tasks: incoming, shotColumnId } = action.payload;
      const incomingIds = new Set(incoming.map((t) => t.id));

      // Remove stale server tasks that match the scope but are no longer in the response
      for (const [id, task] of Object.entries(state.tasks)) {
        if (task.source !== "server") continue;
        if (shotColumnId && task.shotColumnId !== shotColumnId) continue;
        if (!incomingIds.has(id)) {
          delete state.tasks[id];
        }
      }

      // Upsert incoming — skip if a local task with the same id already exists
      for (const task of incoming) {
        const existing = state.tasks[task.id];
        if (existing && existing.source === "local") continue;
        state.tasks[task.id] = task;
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
  upsertServerTasks,
} = taskSlice.actions;

// ─── Server Sync Thunk ─────────────────────────────────

/**
 * Server task record from integralrecord APIs.
 *
 * Status: 0 = failed, 1 = success, 2 = running
 * Remark: on success = video URL/path, on failure = error reason
 */
interface ServerTaskRecord {
  id?: string | number;
  requestId?: string;
  status?: number;
  remark?: string | null;
  responseData?: string | null;
  createTime?: string;
  shotId?: string | number;
  shotColumnId?: string | number;
  modelCode?: string;
  aiName?: string;
  [key: string]: unknown;
}

function serverRecordToTask(record: ServerTaskRecord): Task {
  const id = String(record.id ?? "");
  const now = Date.now();

  let status: TaskStatus = "running";
  let output: TaskOutput | undefined;
  let error: string | undefined;

  const rawStatus = record.status;

  if (rawStatus === 1) {
    // Success — remark contains the video URL/path
    status = "completed";
    const remark = record.remark ?? "";
    if (remark) {
      output = { storagePath: remark, url: remark };
    }
  } else if (rawStatus === 0) {
    // Failed — remark contains the error reason
    status = "failed";
    error = record.remark || "Generation failed";
  }
  // rawStatus === 2 or undefined → running

  return {
    id,
    remoteId: record.requestId ? String(record.requestId) : undefined,
    type: "video",
    source: "server",
    status,
    shotId: record.shotId ? String(record.shotId) : undefined,
    shotColumnId: record.shotColumnId ? String(record.shotColumnId) : undefined,
    input: {},
    output,
    error,
    createdAt: record.createTime ? new Date(record.createTime).getTime() : now,
    updatedAt: now,
  };
}

/**
 * Load running/failed tasks from the server (list API).
 * Called once when dialog opens to restore in-progress tasks.
 */
export const loadServerTasks = createAsyncThunk(
  "task/loadServerTasks",
  async (params: { shotColumnId: string }, { dispatch }) => {
    try {
      const res = await backendApi.post<{ list?: ServerTaskRecord[] }>(
        "/api/ai/record/integralrecord/runningandfailed/list",
        { data: { page: 1, pageSize: 50, shotColumnId: params.shotColumnId } }
      );
      const records = (res as { list?: ServerTaskRecord[] })?.list ?? [];
      const tasks = records.map(serverRecordToTask);

      dispatch(
        upsertServerTasks({
          tasks,
          shotColumnId: params.shotColumnId,
        })
      );
    } catch (err) {
      console.error("[taskSlice] loadServerTasks failed:", err);
    }
  }
);

/**
 * Poll each running server task by ID using the single-item API.
 * Called on an interval — iterates all running server tasks and updates their status.
 * When a task completes or fails, it's updated in place.
 */
export const pollServerTasks = createAsyncThunk(
  "task/pollServerTasks",
  async (_: void, { getState, dispatch }) => {
    const state = getState() as { task: TaskState };
    const runningServerTasks = Object.values(state.task.tasks).filter(
      (t) => t.source === "server" && t.status === "running"
    );

    if (runningServerTasks.length === 0) return;

    for (const task of runningServerTasks) {
      try {
        const record = await backendApi.post<ServerTaskRecord>(
          `/api/ai/record/integralrecord/${task.id}`
        );
        if (!record) continue;
        const updated = serverRecordToTask(record as ServerTaskRecord);
        if (updated.status !== task.status) {
          dispatch(
            applyEvent({
              taskId: task.id,
              status: updated.status,
              output: updated.output,
              error: updated.error,
            })
          );
        }
      } catch (err) {
        console.error(`[taskSlice] poll task ${task.id} failed:`, err);
      }
    }
  }
);

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
